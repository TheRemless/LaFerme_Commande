-- Codes promo (vague 3, bo-carte) : construits complets mais DÉSACTIVÉS. Rien ne s'applique tant que le
-- réglage codes_promo_actifs est faux et qu'aucun code n'est actif : l'offre, le taux, les dates et les
-- supports sont des décisions de Jérémy (docs/lancement/offre-premiere-commande.md). Aucun montant ici.
--
-- 1. codes_promo : un code par support (flyer, autocollant, fiche Google) pour mesurer ce qui ramène des
--    commandes. Pourcentage du total des plats, montant fixe ou livraison offerte ; minimum de commande,
--    dates, plafond d'utilisations, première commande seulement, une fois par client.
-- 2. evaluer_code : le serveur calcule la remise à partir de la base (jamais d'un montant envoyé par le
--    navigateur). « Une fois par client » et « première commande » se vérifient sur l'e-mail normalisé, le
--    téléphone normalisé et l'adresse de livraison, commandes payées ou en cours de paiement seulement.
-- 3. utilisations_codes : une ligne par commande qui a utilisé un code, écrite par le serveur au moment
--    de la commande (branchement au panier et au paiement : PR suivante, avec client-commande).
--
-- Objets partagés recréés : aucun. Ajouts sur une table partagée : trois index sur commandes (expressions,
-- pour vérifier vite un client sur des milliers de commandes) et un réglage neuf.

-- ---------- Normalisation d'un client ----------

-- « Jean.Dupont+promo@Gmail.com » → « jean.dupont@gmail.com » : une étiquette « + » ne fait pas un client neuf.
create function email_normal(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '\+[^@]*@', '@'), '');
$$;

-- « 079 123 45 67 », « +41 79 123 45 67 », « 0041791234567 » → « 41791234567 ».
create function telephone_normal(p text) returns text
language sql immutable as $$
  select nullif(case
    when d like '0041%' then substr(d, 3)
    when d like '41%' then d
    when d like '0%' then '41' || substr(d, 2)
    else d end, '')
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Bâtiment du registre fédéral s'il est connu, sinon rue, numéro et NPA. Null au retrait.
create function adresse_cle(p jsonb) returns text
language sql immutable as $$
  select case when p is null then null
    when coalesce(p ->> 'featureId', '') <> '' then 'egid:' || (p ->> 'featureId')
    else nullif(lower(regexp_replace(coalesce(p ->> 'rue', '') || coalesce(p ->> 'numero', '') || coalesce(p ->> 'npa', ''), '\s', '', 'g')), '') end;
$$;

create index commandes_email_normal_idx on commandes (email_normal(client_email));
create index commandes_telephone_normal_idx on commandes (telephone_normal(client_telephone));
create index commandes_adresse_cle_idx on commandes (adresse_cle(adresse));

-- Commande qui compte pour un client : payée, à encaisser, encaissée, ou paiement en cours depuis moins de
-- 30 minutes (une session Stripe abandonnée ne bloque pas le client pour toujours). Refusée, annulée,
-- remboursée ou échouée : ne compte pas.
create function commande_compte(c commandes) returns boolean
language sql stable as $$
  select c.statut not in ('refusee', 'annulee')
    and (c.statut_paiement in ('paye', 'a_encaisser_retrait', 'encaisse')
         or (c.statut_paiement = 'en_attente' and c.cree_le > now() - interval '30 minutes'));
$$;

-- ---------- Tables ----------

create table codes_promo (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,20}$'),
  -- Nom interne : le support (« Flyer automne », « Fiche Google »). Jamais montré au client.
  libelle text not null check (length(libelle) between 1 and 60),
  type text not null check (type in ('pourcentage', 'montant', 'livraison')),
  -- Pourcentage (1 à 100) ou montant en centimes ; rien pour la livraison offerte.
  valeur integer,
  minimum_centimes integer not null default 0 check (minimum_centimes >= 0),
  debut date,
  fin date,
  plafond_utilisations integer check (plafond_utilisations is null or plafond_utilisations > 0),
  premiere_commande boolean not null default false,
  une_fois_par_client boolean not null default true,
  actif boolean not null default false,
  cree_le timestamptz not null default now(),
  check (
    (type = 'pourcentage' and valeur between 1 and 100)
    or (type = 'montant' and valeur > 0)
    or (type = 'livraison' and valeur is null)
  ),
  check (debut is null or fin is null or debut <= fin)
);

create table utilisations_codes (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references codes_promo (id),
  commande_id uuid not null unique references commandes (id) on delete cascade,
  remise_centimes integer not null check (remise_centimes >= 0),
  cree_le timestamptz not null default now()
);
create index utilisations_codes_code_idx on utilisations_codes (code_id);

alter table codes_promo enable row level security;
alter table utilisations_codes enable row level security;
revoke all on codes_promo, utilisations_codes from anon, authenticated;
grant select, insert, update, delete on codes_promo, utilisations_codes to service_role;

-- Interrupteur général, faux : le site ne propose aucun champ « Code » tant qu'il l'est.
insert into reglages (cle, valeur, proposition) values ('codes_promo_actifs', 'false'::jsonb, true)
  on conflict (cle) do nothing;

-- ---------- Évaluer un code (serveur, au panier et au paiement) ----------

-- p : { code, email, telephone, adresse (jsonb ou null), mode, sous_total_centimes, frais_centimes }.
-- Rend { ok: true, code, type, remise_centimes } ou { ok: false, raison, minimum_centimes? }.
-- raison : desactive, inconnu, inactif, pas_commence, expire, minimum, plafond, deja_utilise,
-- pas_premiere, retrait, client_inconnu.
create function evaluer_code(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  c codes_promo%rowtype;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_email text := email_normal(p ->> 'email');
  v_tel text := telephone_normal(p ->> 'telephone');
  v_adr text := adresse_cle(case when jsonb_typeof(p -> 'adresse') = 'object' then p -> 'adresse' end);
  v_sous_total integer := greatest(coalesce((p ->> 'sous_total_centimes')::integer, 0), 0);
  v_frais integer := greatest(coalesce((p ->> 'frais_centimes')::integer, 0), 0);
  remise integer;
begin
  if coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false) is not true then
    return jsonb_build_object('ok', false, 'raison', 'desactive');
  end if;
  select * into c from codes_promo where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'inconnu');
  end if;
  if not c.actif then
    return jsonb_build_object('ok', false, 'raison', 'inactif');
  end if;
  if c.debut is not null and aujourdhui < c.debut then
    return jsonb_build_object('ok', false, 'raison', 'pas_commence');
  end if;
  if c.fin is not null and aujourdhui > c.fin then
    return jsonb_build_object('ok', false, 'raison', 'expire');
  end if;
  if v_sous_total < c.minimum_centimes then
    return jsonb_build_object('ok', false, 'raison', 'minimum', 'minimum_centimes', c.minimum_centimes);
  end if;
  if c.type = 'livraison' and (p ->> 'mode' is distinct from 'livraison' or v_frais = 0) then
    return jsonb_build_object('ok', false, 'raison', 'retrait');
  end if;
  if c.plafond_utilisations is not null and (
    select count(*) from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
  ) >= c.plafond_utilisations then
    return jsonb_build_object('ok', false, 'raison', 'plafond');
  end if;
  if (c.une_fois_par_client or c.premiere_commande) and v_email is null and v_tel is null then
    return jsonb_build_object('ok', false, 'raison', 'client_inconnu');
  end if;
  if c.une_fois_par_client and exists (
    select 1 from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
      and (email_normal(x.client_email) = v_email or telephone_normal(x.client_telephone) = v_tel or adresse_cle(x.adresse) = v_adr)
  ) then
    return jsonb_build_object('ok', false, 'raison', 'deja_utilise');
  end if;
  if c.premiere_commande and (
    exists (select 1 from commandes x where email_normal(x.client_email) = v_email and commande_compte(x))
    or exists (select 1 from commandes x where telephone_normal(x.client_telephone) = v_tel and commande_compte(x))
    or (v_adr is not null and exists (select 1 from commandes x where adresse_cle(x.adresse) = v_adr and commande_compte(x)))
  ) then
    return jsonb_build_object('ok', false, 'raison', 'pas_premiere');
  end if;
  remise := case c.type
    when 'pourcentage' then round(v_sous_total * c.valeur / 100.0)::integer
    when 'montant' then least(c.valeur, v_sous_total)
    else v_frais end;
  return jsonb_build_object('ok', true, 'code', c.code, 'type', c.type, 'remise_centimes', remise);
end;
$$;

-- Note l'utilisation d'un code par une commande (appelée par le serveur à la création de la commande,
-- après evaluer_code dans la même transaction). Une commande n'utilise qu'un code.
create function noter_utilisation_code(p_code text, p_commande uuid, p_remise integer) returns boolean
language plpgsql as $$
declare
  cid uuid;
begin
  select id into cid from codes_promo where code = upper(btrim(p_code));
  if cid is null or p_remise < 0 then
    return false;
  end if;
  insert into utilisations_codes (code_id, commande_id, remise_centimes) values (cid, p_commande, p_remise)
    on conflict (commande_id) do nothing;
  return found;
end;
$$;

-- ---------- Back-office ----------

-- p : { code, libelle, type, valeur, minimum_centimes, debut, fin, plafond_utilisations, premiere_commande,
--       une_fois_par_client }. Un code naît INACTIF : on l'active à part (modifier_code), en connaissance de cause.
create function creer_code(p jsonb, p_personnel uuid) returns text
language plpgsql as $$
declare
  c codes_promo%rowtype;
begin
  perform gerant_nom(p_personnel);
  if exists (select 1 from codes_promo where code = upper(btrim(p ->> 'code'))) then
    raise exception 'code_existe';
  end if;
  insert into codes_promo (code, libelle, type, valeur, minimum_centimes, debut, fin, plafond_utilisations, premiere_commande, une_fois_par_client, actif)
  values (
    upper(btrim(p ->> 'code')), btrim(p ->> 'libelle'), p ->> 'type', (p ->> 'valeur')::integer,
    coalesce((p ->> 'minimum_centimes')::integer, 0), (p ->> 'debut')::date, (p ->> 'fin')::date,
    (p ->> 'plafond_utilisations')::integer, coalesce((p ->> 'premiere_commande')::boolean, false),
    coalesce((p ->> 'une_fois_par_client')::boolean, true), false
  )
  returning * into c;
  perform journaliser(p_personnel, 'code_promo', c.code, null, to_jsonb(c) - 'id' - 'cree_le');
  return c.code;
end;
$$;

-- Champs facultatifs : libelle, actif, minimum_centimes, debut, fin, plafond_utilisations, premiere_commande,
-- une_fois_par_client ; type et valeur seulement tant que le code n'a servi à aucune commande.
create function modifier_code(p_code text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant codes_promo%rowtype;
  apres codes_promo%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from codes_promo where code = p_code for update;
  if not found then
    return false;
  end if;
  if (p ? 'type' or p ? 'valeur') and exists (select 1 from utilisations_codes where code_id = avant.id) then
    raise exception 'code_deja_utilise';
  end if;
  update codes_promo set
    libelle = case when p ? 'libelle' then btrim(p ->> 'libelle') else libelle end,
    actif = coalesce((p ->> 'actif')::boolean, actif),
    type = coalesce(p ->> 'type', type),
    valeur = case when p ? 'valeur' then (p ->> 'valeur')::integer else valeur end,
    minimum_centimes = coalesce((p ->> 'minimum_centimes')::integer, minimum_centimes),
    debut = case when p ? 'debut' then (p ->> 'debut')::date else debut end,
    fin = case when p ? 'fin' then (p ->> 'fin')::date else fin end,
    plafond_utilisations = case when p ? 'plafond_utilisations' then (p ->> 'plafond_utilisations')::integer else plafond_utilisations end,
    premiere_commande = coalesce((p ->> 'premiere_commande')::boolean, premiere_commande),
    une_fois_par_client = coalesce((p ->> 'une_fois_par_client')::boolean, une_fois_par_client)
  where id = avant.id
  returning * into apres;
  perform journaliser(p_personnel, 'code_promo', p_code, to_jsonb(avant) - 'id' - 'cree_le', to_jsonb(apres) - 'id' - 'cree_le');
  return true;
end;
$$;

-- Interrupteur général (réglage codes_promo_actifs), journalisé.
create function activer_codes_promo(p_actif boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select valeur into avant from reglages where cle = 'codes_promo_actifs' for update;
  update reglages set valeur = to_jsonb(p_actif), proposition = false where cle = 'codes_promo_actifs';
  perform journaliser(p_personnel, 'codes_promo', 'codes_promo_actifs', jsonb_build_object('actif', avant), jsonb_build_object('actif', p_actif));
  return true;
end;
$$;

-- Codes et ce qu'ils ont rapporté : commandes qui comptent, remise accordée, total encaissé (après remise).
create function codes_gestion() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'actifs', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'libelle', c.libelle, 'type', c.type, 'valeur', c.valeur, 'minimum_centimes', c.minimum_centimes,
        'debut', c.debut, 'fin', c.fin, 'plafond_utilisations', c.plafond_utilisations, 'premiere_commande', c.premiere_commande,
        'une_fois_par_client', c.une_fois_par_client, 'actif', c.actif,
        'commandes', coalesce(s.n, 0), 'remise_centimes', coalesce(s.remise, 0), 'total_centimes', coalesce(s.total, 0)
      ) order by c.cree_le desc)
      from codes_promo c
      left join lateral (
        select count(*) as n, sum(u.remise_centimes) as remise, sum(x.total_centimes) as total
        from utilisations_codes u join commandes x on x.id = u.commande_id
        where u.code_id = c.id and commande_compte(x)
      ) s on true
    ), '[]'::jsonb)
  );
$$;

-- ---------- Droits ----------

revoke execute on function
  email_normal(text), telephone_normal(text), adresse_cle(jsonb), commande_compte(commandes), evaluer_code(jsonb),
  noter_utilisation_code(text, uuid, integer), creer_code(jsonb, uuid), modifier_code(text, jsonb, uuid),
  activer_codes_promo(boolean, uuid), codes_gestion()
  from public, anon, authenticated;
grant execute on function
  email_normal(text), telephone_normal(text), adresse_cle(jsonb), commande_compte(commandes), evaluer_code(jsonb),
  noter_utilisation_code(text, uuid, integer), creer_code(jsonb, uuid), modifier_code(text, jsonb, uuid),
  activer_codes_promo(boolean, uuid), codes_gestion()
  to service_role;
