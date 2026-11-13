-- Vague 3, bo-commandes : réclamations des clients suivies comme des dossiers, et gestes commerciaux.
-- Un vendredi soir : « il manque le tiramisù », « c'est arrivé froid », « 40 minutes de retard ». L'équipe
-- note la plainte en un geste (depuis la fiche de la commande), le gérant la suit jusqu'à sa clôture et
-- décide d'un geste. Le client peut aussi la signaler depuis son suivi (formulaire de client-compte).
--
-- Gestes : « remboursement » relie un remboursement déjà fait par « Rembourser » (G02, existant) ; « aucun »
-- avec une raison. « Plat offert à la prochaine commande » (noté sur le client, appliqué à la main par
-- l'équipe) est une décision de Jérémy (D3) : désactivé par défaut (réglage gestes_commerciaux_actifs).
-- Aucun avoir en francs ici : il attend les codes de bo-carte et l'export de bo-pilotage.
--
-- Objets partagés recréés : aucun. Réutilise equipe_nom (bo-operations) sans la toucher. Compatible avant et après : le code de main n'appelle aucune de ces fonctions.

insert into reglages (cle, valeur, proposition) values ('gestes_commerciaux_actifs', 'false', true)
on conflict (cle) do nothing;

create table reclamations (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid references commandes (id) on delete set null,
  email text not null check (email = lower(btrim(email)) and length(email) between 5 and 120),
  source text not null check (source in ('telephone', 'sur_place', 'email', 'suivi')),
  type text not null check (type in ('retard', 'manquant', 'froid', 'erreur', 'qualite', 'livraison', 'autre')),
  description text not null check (length(description) between 3 and 500),
  statut text not null default 'ouverte' check (statut in ('ouverte', 'en_cours', 'close')),
  geste text check (geste in ('remboursement', 'plat_offert', 'aucun')),
  geste_detail text check (length(geste_detail) <= 200),
  remboursement_id uuid references remboursements (id) on delete set null,
  resolution text check (length(resolution) <= 500),
  cree_par text not null,
  cree_le timestamptz not null default now(),
  close_par text,
  close_le timestamptz,
  check ((statut = 'close') = (close_le is not null))
);
create index reclamations_statut_idx on reclamations (statut, cree_le desc);
create index reclamations_commande_idx on reclamations (commande_id);
create index reclamations_email_idx on reclamations (email, cree_le desc);

-- Fil du dossier : chaque mot de l'équipe, chaque changement d'état.
create table suivis_reclamation (
  id bigint generated always as identity primary key,
  reclamation_id uuid not null references reclamations (id) on delete cascade,
  par text not null,
  texte text not null check (length(texte) between 1 and 500),
  le timestamptz not null default now()
);
create index suivis_reclamation_idx on suivis_reclamation (reclamation_id, le);

-- Plat offert à la prochaine commande : en attente jusqu'à ce que l'équipe l'applique sur une commande.
create table gestes_client (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) between 5 and 120),
  reclamation_id uuid references reclamations (id) on delete set null,
  detail text not null check (length(detail) between 3 and 200),
  cree_par text not null,
  cree_le timestamptz not null default now(),
  offert_commande_id uuid references commandes (id) on delete set null,
  offert_par text,
  offert_le timestamptz
);
create index gestes_client_attente_idx on gestes_client (email) where offert_le is null;

alter table reclamations enable row level security;
alter table suivis_reclamation enable row level security;
alter table gestes_client enable row level security;
revoke all on reclamations, suivis_reclamation, gestes_client from anon, authenticated;
grant select, insert, update, delete on reclamations, suivis_reclamation, gestes_client to service_role;

create function gestes_actifs() returns boolean
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'gestes_commerciaux_actifs' and jsonb_typeof(valeur) = 'boolean'), false);
$$;

-- Membre actif de l'équipe : equipe_nom(uuid) de 20261130090000_coup_de_feu.sql (bo-operations), réutilisée
-- telle quelle (liaison au moment de l'appel : l'ordre des migrations ne compte pas).

-- ---------- Ouvrir ----------

-- Par l'équipe (téléphone, sur place, e-mail). p : { commande_id? , email? (sans commande), source, type, description }.
create function ouvrir_reclamation(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := equipe_nom(p_personnel);
  c commandes%rowtype;
  e text;
  r reclamations%rowtype;
begin
  if p ->> 'commande_id' is not null then
    select * into c from commandes where id = (p ->> 'commande_id')::uuid;
    if not found then
      raise exception 'commande_inconnue';
    end if;
    e := lower(btrim(c.client_email));
  else
    e := lower(btrim(coalesce(p ->> 'email', '')));
    if not exists (select 1 from commandes where lower(client_email) = e) then
      raise exception 'client_inconnu';
    end if;
  end if;
  if coalesce(p ->> 'source', '') not in ('telephone', 'sur_place', 'email') then
    raise exception 'source_invalide';
  end if;
  insert into reclamations (commande_id, email, source, type, description, cree_par)
    values (c.id, e, p ->> 'source', p ->> 'type', btrim(p ->> 'description'), nom)
    returning * into r;
  insert into suivis_reclamation (reclamation_id, par, texte) values (r.id, nom, 'Réclamation ouverte.');
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, nom, 'reclamation', r.id::text, null, jsonb_build_object('type', r.type, 'commande_id', r.commande_id, 'source', r.source));
  return to_jsonb(r);
end;
$$;

-- Par le client, depuis son suivi (jeton). Trois réclamations au plus par commande, et seulement une
-- commande acceptée ou terminée (pas une commande refusée, ni plus de 14 jours après).
create function reclamation_client(p_jeton text, p_type text, p_description text) returns jsonb
language plpgsql as $$
declare
  c commandes%rowtype;
  r reclamations%rowtype;
begin
  select * into c from commandes where jeton_suivi = p_jeton for update;
  if not found then
    return jsonb_build_object('resultat', 'inconnue');
  end if;
  if c.statut not in ('acceptee', 'en_preparation', 'prete', 'partie', 'terminee') or c.cree_le < now() - interval '14 days' then
    return jsonb_build_object('resultat', 'impossible');
  end if;
  if (select count(*) from reclamations where commande_id = c.id) >= 3 then
    return jsonb_build_object('resultat', 'trop');
  end if;
  insert into reclamations (commande_id, email, source, type, description, cree_par)
    values (c.id, lower(btrim(c.client_email)), 'suivi', p_type, btrim(p_description), 'client')
    returning * into r;
  insert into suivis_reclamation (reclamation_id, par, texte) values (r.id, 'client', 'Réclamation envoyée depuis le suivi.');
  return jsonb_build_object('resultat', 'ouverte', 'id', r.id, 'numero', c.numero);
end;
$$;

-- ---------- Suivre, geste, clôturer (gérant) ----------

-- p : { texte?, statut?: en_cours | close | ouverte, resolution? (exigée pour clore) }
create function suivre_reclamation(p_id uuid, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  r reclamations%rowtype;
  vers text := p ->> 'statut';
  t text := btrim(coalesce(p ->> 'texte', ''));
begin
  select * into r from reclamations where id = p_id for update;
  if not found then
    raise exception 'reclamation_inconnue';
  end if;
  if vers is not null and vers not in ('ouverte', 'en_cours', 'close') then
    raise exception 'statut_invalide';
  end if;
  if vers = 'close' and length(btrim(coalesce(p ->> 'resolution', ''))) < 3 then
    raise exception 'resolution_manquante';
  end if;
  if vers is null and t = '' then
    raise exception 'rien_a_faire';
  end if;
  if length(t) > 500 then
    raise exception 'texte_trop_long';
  end if;
  if t <> '' then
    insert into suivis_reclamation (reclamation_id, par, texte) values (p_id, nom, t);
  end if;
  if vers is not null and vers <> r.statut then
    update reclamations set statut = vers,
      resolution = case when vers = 'close' then btrim(p ->> 'resolution') else resolution end,
      close_par = case when vers = 'close' then nom end,
      close_le = case when vers = 'close' then now() end
    where id = p_id;
    insert into suivis_reclamation (reclamation_id, par, texte) values (p_id, nom,
      case vers when 'close' then 'Close : ' || btrim(p ->> 'resolution') when 'en_cours' then 'Prise en charge.' else 'Rouverte.' end);
    perform journaliser(p_personnel, 'reclamation', p_id::text, jsonb_build_object('statut', r.statut), jsonb_build_object('statut', vers));
  end if;
  return (select to_jsonb(x) from reclamations x where x.id = p_id);
end;
$$;

-- p : { geste: remboursement | plat_offert | aucun, detail?, remboursement_id? }
-- remboursement : un remboursement déjà fait de la même commande (le bouton « Rembourser » existant).
-- plat_offert : désactivé tant que gestes_commerciaux_actifs est faux ; crée le geste en attente sur le client.
create function noter_geste_reclamation(p_id uuid, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  r reclamations%rowtype;
  g text := p ->> 'geste';
  d text := btrim(coalesce(p ->> 'detail', ''));
  rb remboursements%rowtype;
begin
  select * into r from reclamations where id = p_id for update;
  if not found then
    raise exception 'reclamation_inconnue';
  end if;
  if r.statut = 'close' then
    raise exception 'reclamation_close';
  end if;
  if r.geste is not null then
    raise exception 'geste_deja_note';
  end if;
  if g = 'remboursement' then
    select * into rb from remboursements where id = (p ->> 'remboursement_id')::uuid;
    if not found or rb.commande_id is distinct from r.commande_id or rb.statut = 'echec' then
      raise exception 'remboursement_invalide';
    end if;
    d := (rb.montant_centimes / 100.0)::numeric(10, 2)::text || ' CHF, ' || rb.motif;
  elsif g = 'plat_offert' then
    if not gestes_actifs() then
      raise exception 'gestes_desactives';
    end if;
    if length(d) < 3 or length(d) > 200 then
      raise exception 'detail_invalide';
    end if;
    insert into gestes_client (email, reclamation_id, detail, cree_par) values (r.email, r.id, d, nom);
  elsif g = 'aucun' then
    if length(d) < 3 or length(d) > 200 then
      raise exception 'detail_invalide';
    end if;
  else
    raise exception 'geste_invalide';
  end if;
  update reclamations set geste = g, geste_detail = d, remboursement_id = rb.id, statut = case when statut = 'ouverte' then 'en_cours' else statut end
    where id = p_id;
  insert into suivis_reclamation (reclamation_id, par, texte) values (p_id, nom,
    case g when 'remboursement' then 'Geste : remboursement de ' || d when 'plat_offert' then 'Geste : offert à la prochaine commande, ' || d else 'Pas de geste : ' || d end);
  perform journaliser(p_personnel, 'reclamation', p_id::text, null, jsonb_build_object('geste', g, 'detail', d));
  return (select to_jsonb(x) from reclamations x where x.id = p_id);
end;
$$;

-- ---------- Plat offert : à appliquer sur la prochaine commande ----------

-- Pour la tablette et la fiche : gestes en attente de ce client (par e-mail). Vide tant que le réglage est faux.
create function gestes_en_attente(p_email text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'detail', g.detail, 'cree_par', g.cree_par, 'cree_le', g.cree_le) order by g.cree_le), '[]'::jsonb)
  from gestes_client g
  where gestes_actifs() and g.email = lower(btrim(coalesce(p_email, ''))) and g.offert_le is null;
$$;

-- L'équipe a mis le plat offert dans la commande (sur le ticket, à la main) : le geste est consommé.
create function appliquer_geste(p_geste uuid, p_commande uuid, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  nom text := equipe_nom(p_personnel);
begin
  if not gestes_actifs() then
    raise exception 'gestes_desactives';
  end if;
  update gestes_client g set offert_commande_id = p_commande, offert_par = nom, offert_le = now()
    where g.id = p_geste and g.offert_le is null
      and exists (select 1 from commandes c where c.id = p_commande and lower(c.client_email) = g.email);
  if not found then
    return false;
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    select p_commande, c.statut, c.statut, 'tablette:' || nom, 'geste offert ' || g.detail
    from commandes c, gestes_client g where c.id = p_commande and g.id = p_geste;
  return true;
end;
$$;

-- ---------- Lecture ----------

-- p : { statuts?: [..], types?: [..], debut?, fin? (date de la plainte), commande_id?, email?, page?, par_page? }
create function reclamations_gestion(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  statuts text[] := case when jsonb_typeof(p -> 'statuts') = 'array' then array(select jsonb_array_elements_text(p -> 'statuts')) end;
  types text[] := case when jsonb_typeof(p -> 'types') = 'array' then array(select jsonb_array_elements_text(p -> 'types')) end;
  par_page integer := least(greatest(coalesce((p ->> 'par_page')::integer, 50), 10), 100);
  page integer := greatest(coalesce((p ->> 'page')::integer, 1), 1);
  r jsonb;
begin
  with base as (
    select x.* from reclamations x
    where (p ->> 'debut' is null or (x.cree_le at time zone 'Europe/Zurich')::date >= (p ->> 'debut')::date)
      and (p ->> 'fin' is null or (x.cree_le at time zone 'Europe/Zurich')::date <= (p ->> 'fin')::date)
      and (types is null or x.type = any (types))
      and (p ->> 'commande_id' is null or x.commande_id = (p ->> 'commande_id')::uuid)
      and (p ->> 'email' is null or x.email = lower(p ->> 'email'))
  ),
  filtre as (select * from base where statuts is null or statut = any (statuts)),
  rangees as (select f.*, row_number() over (order by (f.statut = 'close'), f.cree_le desc, f.id) as rang from filtre f)
  select jsonb_build_object(
    'page', page, 'par_page', par_page, 'total', (select count(*) from filtre),
    'compteurs', (select coalesce(jsonb_object_agg(s.statut, s.n), '{}'::jsonb) from (select statut, count(*) as n from base group by statut) s),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'commande_id', x.commande_id, 'numero', c.numero, 'jour_service', c.jour_service, 'email', x.email,
        'client', coalesce(c.client_prenom || ' ' || c.client_nom, x.email), 'source', x.source, 'type', x.type,
        'description', x.description, 'statut', x.statut, 'geste', x.geste, 'cree_par', x.cree_par, 'cree_le', x.cree_le, 'close_le', x.close_le
      ) order by x.rang) from rangees x left join commandes c on c.id = x.commande_id
      where x.rang > (page - 1) * par_page and x.rang <= page * par_page), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

create function fiche_reclamation_gestion(p_id uuid) returns jsonb
language sql stable as $$
  select to_jsonb(x) || jsonb_build_object(
    'commande', (select jsonb_build_object('id', c.id, 'numero', c.numero, 'jour_service', c.jour_service, 'statut', c.statut, 'mode', c.mode,
        'total_centimes', c.total_centimes, 'client_prenom', c.client_prenom, 'client_nom', c.client_nom, 'client_telephone', c.client_telephone)
      from commandes c where c.id = x.commande_id),
    'suivis', coalesce((select jsonb_agg(jsonb_build_object('par', s.par, 'texte', s.texte, 'le', s.le) order by s.le, s.id) from suivis_reclamation s where s.reclamation_id = x.id), '[]'::jsonb),
    'remboursements', coalesce((select jsonb_agg(jsonb_build_object('id', rb.id, 'montant_centimes', rb.montant_centimes, 'motif', rb.motif, 'statut', rb.statut, 'cree_le', rb.cree_le) order by rb.cree_le)
      from remboursements rb where rb.commande_id = x.commande_id and rb.statut <> 'echec'), '[]'::jsonb),
    'autres', (select count(*) from reclamations y where y.email = x.email and y.id <> x.id),
    'gestes_actifs', gestes_actifs()
  )
  from reclamations x where x.id = p_id;
$$;

revoke execute on function
  gestes_actifs(), ouvrir_reclamation(jsonb, uuid), reclamation_client(text, text, text), suivre_reclamation(uuid, jsonb, uuid),
  noter_geste_reclamation(uuid, jsonb, uuid), gestes_en_attente(text), appliquer_geste(uuid, uuid, uuid), reclamations_gestion(jsonb), fiche_reclamation_gestion(uuid)
  from public, anon, authenticated;
grant execute on function
  gestes_actifs(), ouvrir_reclamation(jsonb, uuid), reclamation_client(text, text, text), suivre_reclamation(uuid, jsonb, uuid),
  noter_geste_reclamation(uuid, jsonb, uuid), gestes_en_attente(text), appliquer_geste(uuid, uuid, uuid), reclamations_gestion(jsonb), fiche_reclamation_gestion(uuid)
  to service_role;
