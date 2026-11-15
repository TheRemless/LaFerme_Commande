-- Vague 3, client-compte : cagnotte des clients (programme de fidélité validé par Jérémy le 15.11.2026, « Oui aller »).
--
-- Règles :
-- - une cagnotte en francs par compte client, sans points ;
-- - gain : 5 % du montant des plats, hors frais de livraison et hors complément payé par lien, après code promo,
--   cagnotte utilisée et remboursements, arrondi au centime inférieur ;
-- - crédit seulement quand la commande est livrée ou retirée (statut « terminee », pas une livraison close
--   « client absent ») : rien si elle est refusée, annulée ou remboursée ; un remboursement après coup retire la part
--   correspondante, sans jamais rendre le solde négatif (on retire ce qui reste) ;
-- - utilisation : dès le seuil (CHF 10), au paiement en ligne d'un compte, tout ou partie, sans dépasser le montant
--   des plats. Jamais au téléphone ni au comptoir au lancement. Le paiement en ligne garde au moins CHF 0.50 (minimum
--   de Stripe) ;
-- - la part payée en cagnotte revient en cagnotte si la commande est refusée, annulée, son paiement échoue ou si elle
--   est remboursée en entier. Un remboursement partiel ne rend que de l'argent (au plus le total payé) ;
-- - expiration : tout le solde, 12 mois après la dernière commande (règle de Jérémy : « 12 mois sans commande »),
--   jamais pendant une commande en cours. Un e-mail part 30 jours avant si le client ne l'a pas refusé dans son
--   compte ;
-- - soirs calmes : le gérant choisit des soirs (jour de la semaine ou date) où le taux est doublé. La base décide
--   d'après l'heure promise de la commande ;
-- - interrupteur général `fidelite_active`, construit éteint : la session principale l'allume en vraie base après la
--   fusion.
--
-- Registre unique : cagnotte_mouvements, le solde est la somme des mouvements du compte.
-- Objets partagés recréés : export_compte (depuis 20261202110000_rattacher_commandes.sql, seul ajout : la cagnotte).
-- Ajouts sur des tables partagées : commandes.cagnotte_centimes, comptes.rappel_cagnotte, quatre réglages et une ligne
-- dans interrupteurs_gestion, un déclencheur sur commandes et un sur remboursements.
-- Compta : la cagnotte utilisée est une réduction de prix. total_centimes et tva_centimes sont déjà nets (comme pour
-- un code promo) : clôture, rapports et export Crésus restent justes sans être recréés.

insert into reglages (cle, valeur, proposition) values
  ('fidelite_active', 'false', false),
  ('fidelite_taux_pourcent', '5', false),
  ('fidelite_seuil_centimes', '1000', false),
  ('fidelite_soirs_doubles', '{"jours": [], "dates": []}', false)
  on conflict (cle) do nothing;

insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('fidelite_active', 'Cagnotte des clients',
    'Les clients avec un compte gagnent 5 % des plats à chaque commande livrée ou retirée et l''utilisent au paiement en ligne dès CHF 10. Taux, seuil et soirs doublés : rubrique Cagnotte plus bas.', 'aucun', 80)
  on conflict (cle) do nothing;

alter table commandes add column cagnotte_centimes integer not null default 0 check (cagnotte_centimes >= 0);
alter table comptes add column rappel_cagnotte boolean not null default true;

create table cagnotte_mouvements (
  id bigint generated always as identity primary key,
  compte_id uuid not null references comptes (id) on delete cascade,
  commande_id uuid references commandes (id) on delete set null,
  type text not null check (type in ('gain', 'utilise', 'rendu', 'retrait', 'expire', 'ajustement', 'parrainage')),
  montant_centimes integer not null check (montant_centimes <> 0),
  taux_pourcent numeric(5, 2),
  motif text check (motif is null or length(motif) between 3 and 200),
  par text,
  cree_le timestamptz not null default now()
);
create index cagnotte_mouvements_compte_idx on cagnotte_mouvements (compte_id, cree_le);
-- Jamais deux gains, deux utilisations ou deux restitutions pour la même commande.
create unique index cagnotte_mouvements_unique_idx on cagnotte_mouvements (commande_id, type)
  where commande_id is not null and type in ('gain', 'utilise', 'rendu');
alter table cagnotte_mouvements enable row level security;
revoke all on cagnotte_mouvements from anon, authenticated;
grant select, insert on cagnotte_mouvements to service_role;

-- Rappel avant expiration : un seul par compte et par date de dernière commande.
create table rappels_cagnotte (
  compte_id uuid not null references comptes (id) on delete cascade,
  activite_le date not null,
  envoye_le timestamptz not null default now(),
  primary key (compte_id, activite_le)
);
alter table rappels_cagnotte enable row level security;
revoke all on rappels_cagnotte from anon, authenticated;
grant select, insert on rappels_cagnotte to service_role;

-- ---------- Réglages ----------

create function fidelite_active() returns boolean
language sql stable as $$
  select coalesce((select valeur = 'true'::jsonb from reglages where cle = 'fidelite_active'), false);
$$;

create function fidelite_entier(p_cle text, p_defaut integer) returns integer
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::integer from reglages where cle = p_cle and jsonb_typeof(valeur) = 'number'), p_defaut);
$$;

-- Taux de base borné de 3 à 10 %.
create function fidelite_taux() returns integer
language sql stable as $$
  select least(greatest(fidelite_entier('fidelite_taux_pourcent', 5), 3), 10);
$$;

create function fidelite_seuil() returns integer
language sql stable as $$
  select greatest(fidelite_entier('fidelite_seuil_centimes', 1000), 0);
$$;

-- ---------- Calculs ----------

create function solde_cagnotte(p_compte uuid) returns integer
language sql stable as $$
  select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements where compte_id = p_compte;
$$;

-- Taux de la commande : doublé si elle est promise un soir (dès 15h, heure de Genève) choisi par le gérant, par jour
-- de la semaine (1 lundi … 7 dimanche) ou par date. L'heure promise, sinon le créneau demandé, sinon l'heure de la
-- commande : jamais l'heure du navigateur.
create function taux_cagnotte(o commandes) returns integer
language plpgsql stable as $$
declare
  instant timestamp := coalesce(o.heure_confirmee, o.cree_le) at time zone 'Europe/Zurich';
  jour date := case when o.heure_confirmee is null and o.quand_date is not null then o.quand_date else instant::date end;
  minutes integer := case when o.heure_confirmee is null and o.quand_minutes is not null then o.quand_minutes
                          else extract(hour from instant)::integer * 60 + extract(minute from instant)::integer end;
  soirs jsonb := coalesce((select valeur from reglages where cle = 'fidelite_soirs_doubles'), '{}'::jsonb);
  base integer := fidelite_taux();
begin
  if minutes >= 15 * 60 and (
    coalesce(soirs -> 'jours', '[]'::jsonb) @> to_jsonb(extract(isodow from jour)::integer)
    or coalesce(soirs -> 'dates', '[]'::jsonb) @> to_jsonb(to_char(jour, 'YYYY-MM-DD'))
  ) then
    return base * 2;
  end if;
  return base;
end;
$$;

-- Remise d'un code promo qui porte sur les plats (un code « livraison » porte sur les frais).
create function remise_plats(o commandes) returns integer
language sql stable as $$
  select case when (select type from codes_promo where code = o.code_promo) = 'livraison' then 0
              else least(o.remise_centimes, o.sous_total_centimes) end;
$$;

-- Montant des plats qui donne droit au gain : plats, moins la remise sur les plats, la cagnotte utilisée et l'argent
-- déjà rendu (remboursements faits, en ligne, en espèces ou déduits au comptoir).
create function base_cagnotte(o commandes) returns integer
language sql stable as $$
  select greatest(
    o.sous_total_centimes - remise_plats(o) - o.cagnotte_centimes
      - coalesce((select sum(r.montant_centimes) from remboursements r where r.commande_id = o.id and r.statut = 'fait'), 0),
    0)::integer;
$$;

-- ---------- Mouvements liés aux commandes ----------

-- Gain à la remise (livrée ou retirée). Une seule fois par commande ; rien si l'interrupteur est éteint, sans compte,
-- pour une commande détachée d'un compte supprimé ou une livraison close « client absent ».
create function crediter_cagnotte(p_commande uuid) returns integer
language plpgsql as $$
declare
  o commandes%rowtype;
  t integer;
  g integer;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null or o.detachee_du_compte
     or o.motif is not distinct from 'Client absent à la livraison.' or not fidelite_active() then
    return 0;
  end if;
  if exists (select 1 from cagnotte_mouvements where commande_id = o.id and type = 'gain') then
    return 0;
  end if;
  t := taux_cagnotte(o);
  g := floor(base_cagnotte(o) * t / 100.0)::integer;
  if g <= 0 then
    return 0;
  end if;
  insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, taux_pourcent)
    values (o.compte_id, o.id, 'gain', g, t);
  return g;
end;
$$;

-- La cagnotte utilisée revient au compte (refus, annulation, paiement échoué, remboursement total). Une seule fois.
create function rendre_cagnotte(p_commande uuid) returns integer
language plpgsql as $$
declare
  u cagnotte_mouvements%rowtype;
begin
  select * into u from cagnotte_mouvements where commande_id = p_commande and type = 'utilise';
  if not found or exists (select 1 from cagnotte_mouvements where commande_id = p_commande and type = 'rendu') then
    return 0;
  end if;
  insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes)
    values (u.compte_id, p_commande, 'rendu', -u.montant_centimes);
  return -u.montant_centimes;
end;
$$;

-- Après un remboursement : le gain de la commande est recalculé sur ce qui reste payé. La différence est retirée,
-- au plus le solde du compte (jamais de solde négatif).
create function ajuster_gain(p_commande uuid) returns integer
language plpgsql as $$
declare
  o commandes%rowtype;
  gain cagnotte_mouvements%rowtype;
  du integer;
  deja integer;
  retrait integer;
begin
  select * into o from commandes where id = p_commande;
  select * into gain from cagnotte_mouvements where commande_id = p_commande and type = 'gain';
  if not found or o.compte_id is null then
    return 0;
  end if;
  perform 1 from comptes where id = gain.compte_id for update;
  du := floor(base_cagnotte(o) * gain.taux_pourcent / 100.0)::integer;
  deja := gain.montant_centimes + coalesce((select sum(montant_centimes) from cagnotte_mouvements
                                            where commande_id = p_commande and type = 'retrait'), 0);
  retrait := least(deja - du, greatest(solde_cagnotte(gain.compte_id), 0));
  if retrait <= 0 then
    return 0;
  end if;
  insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
    values (gain.compte_id, p_commande, 'retrait', -retrait, 'Commande remboursée');
  return -retrait;
end;
$$;

create function cagnotte_au_statut() returns trigger
language plpgsql as $$
begin
  if new.statut = 'terminee' and old.statut is distinct from 'terminee' then
    perform crediter_cagnotte(new.id);
  end if;
  if (new.statut in ('refusee', 'annulee') and old.statut is distinct from new.statut)
     or (new.statut_paiement in ('rembourse', 'echec') and old.statut_paiement is distinct from new.statut_paiement) then
    perform rendre_cagnotte(new.id);
    perform ajuster_gain(new.id);
  end if;
  return null;
end;
$$;
create trigger commandes_cagnotte after update of statut, statut_paiement on commandes
  for each row execute function cagnotte_au_statut();

create function cagnotte_au_remboursement() returns trigger
language plpgsql as $$
begin
  if new.statut = 'fait' and (tg_op = 'INSERT' or old.statut is distinct from 'fait') then
    perform ajuster_gain(new.commande_id);
  end if;
  return null;
end;
$$;
create trigger remboursements_cagnotte after insert or update of statut on remboursements
  for each row execute function cagnotte_au_remboursement();

-- ---------- Utilisation au paiement ----------

-- Crée la commande (avec ou sans code promo) et y déduit la cagnotte, dans une seule transaction et sous verrou du
-- compte : deux paiements en même temps ne dépensent pas deux fois le même solde. Le montant est recalculé ici :
-- au plus ce qui est demandé, le solde, les plats après remise, et le paiement en ligne garde au moins CHF 0.50.
-- Erreurs : cagnotte_refusee:compte | desactive | comptoir | seuil | montant (la commande n'est alors pas créée).
create function creer_commande_paiement(p jsonb, p_code text, p_cagnotte integer) returns jsonb
language plpgsql as $$
declare
  r jsonb;
  o commandes%rowtype;
  cid uuid := (p ->> 'compte_id')::uuid;
  solde integer;
  montant integer;
  total integer;
begin
  if p_code is not null and btrim(p_code) <> '' then
    r := creer_commande_code(p, p_code);
  else
    select jsonb_build_object('id', x.id, 'numero', x.numero, 'jeton_suivi', x.jeton_suivi, 'deja', x.deja,
                              'total_centimes', (p ->> 'total_centimes')::integer, 'remise_centimes', 0)
      into r from creer_commande(p) x;
  end if;
  select * into o from commandes where id = (r ->> 'id')::uuid;
  if (r ->> 'deja')::boolean or coalesce(p_cagnotte, 0) <= 0 then
    return r || jsonb_build_object('total_centimes', o.total_centimes, 'cagnotte_centimes', o.cagnotte_centimes);
  end if;
  if cid is null then
    raise exception 'cagnotte_refusee:compte';
  end if;
  if not fidelite_active() then
    raise exception 'cagnotte_refusee:desactive';
  end if;
  if o.moyen_paiement <> 'en_ligne' then
    raise exception 'cagnotte_refusee:comptoir';
  end if;
  perform 1 from comptes where id = cid for update;
  solde := solde_cagnotte(cid);
  if solde < fidelite_seuil() then
    raise exception 'cagnotte_refusee:seuil';
  end if;
  select * into o from commandes where id = o.id for update;
  montant := least(p_cagnotte, solde, o.sous_total_centimes - remise_plats(o), o.total_centimes - 50);
  if montant <= 0 then
    raise exception 'cagnotte_refusee:montant';
  end if;
  total := o.total_centimes - montant;
  update commandes set cagnotte_centimes = montant, total_centimes = total,
    tva_centimes = round(total * taux_tva_pourcent / (100 + taux_tva_pourcent))::integer
    where id = o.id;
  insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes)
    values (cid, o.id, 'utilise', -montant);
  return r || jsonb_build_object('total_centimes', total, 'cagnotte_centimes', montant);
end;
$$;

-- ---------- Expiration et rappel ----------

-- Dernière activité : la dernière commande (hors paiement abandonné), sinon le dernier mouvement.
create function activite_cagnotte(p_compte uuid) returns timestamptz
language sql stable as $$
  select coalesce(
    (select max(cree_le) from commandes where compte_id = p_compte and statut not in ('paiement_en_attente', 'annulee')),
    (select max(cree_le) from cagnotte_mouvements where compte_id = p_compte)
  );
$$;

-- Tout le solde expire 12 mois après la dernière activité, jamais pendant une commande en cours.
create function expirer_cagnottes() returns integer
language plpgsql as $$
declare
  c record;
  n integer := 0;
  s integer;
begin
  for c in
    select m.compte_id from cagnotte_mouvements m group by m.compte_id having sum(m.montant_centimes) > 0
  loop
    continue when activite_cagnotte(c.compte_id) >= now() - interval '12 months';
    continue when exists (select 1 from commandes where compte_id = c.compte_id
                          and statut in ('paiement_en_attente', 'nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie'));
    perform 1 from comptes where id = c.compte_id for update;
    s := solde_cagnotte(c.compte_id);
    if s > 0 then
      insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif)
        values (c.compte_id, 'expire', -s, '12 mois sans commande');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Rappels à envoyer : solde positif, expiration dans les 30 jours, rappel accepté. Chaque compte n'est rendu qu'une
-- fois par date de dernière activité (noté ici, avant l'envoi).
-- [{ email, prenom, solde_centimes, expire_le }]
create function rappels_cagnotte_dus() returns jsonb
language plpgsql as $$
declare
  c record;
  a timestamptz;
  liste jsonb := '[]'::jsonb;
begin
  if not fidelite_active() then
    return liste;
  end if;
  for c in
    select k.id, k.email, k.prenom, sum(m.montant_centimes)::integer as solde
    from comptes k join cagnotte_mouvements m on m.compte_id = k.id
    where k.rappel_cagnotte
    group by k.id having sum(m.montant_centimes) > 0
  loop
    a := activite_cagnotte(c.id);
    continue when a + interval '12 months' > now() + interval '30 days' or a + interval '12 months' <= now();
    insert into rappels_cagnotte (compte_id, activite_le) values (c.id, (a at time zone 'Europe/Zurich')::date)
      on conflict do nothing;
    continue when not found;
    liste := liste || jsonb_build_object('email', c.email, 'prenom', c.prenom, 'solde_centimes', c.solde,
      'expire_le', to_char((a + interval '12 months') at time zone 'Europe/Zurich', 'YYYY-MM-DD'));
  end loop;
  return liste;
end;
$$;

-- ---------- Compte du client ----------

-- { active, solde_centimes, seuil_centimes, taux_pourcent, expire_le, rappel, mouvements: [{ type, montant_centimes,
--   numero, cree_le }] } (les 20 derniers mouvements, sans l'auteur d'un ajustement).
create function cagnotte_compte(p_compte uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'active', fidelite_active(),
    'solde_centimes', solde_cagnotte(k.id),
    'seuil_centimes', fidelite_seuil(),
    'taux_pourcent', fidelite_taux(),
    'expire_le', case when solde_cagnotte(k.id) > 0
      then to_char((activite_cagnotte(k.id) + interval '12 months') at time zone 'Europe/Zurich', 'YYYY-MM-DD') end,
    'rappel', k.rappel_cagnotte,
    'mouvements', coalesce((
      select jsonb_agg(jsonb_build_object('type', x.type, 'montant_centimes', x.montant_centimes, 'numero', x.numero,
        'motif', x.motif, 'cree_le', x.cree_le) order by x.cree_le desc, x.id desc)
      from (
        select m.id, m.type, m.montant_centimes, m.motif, m.cree_le, o.numero
        from cagnotte_mouvements m left join commandes o on o.id = m.commande_id
        where m.compte_id = k.id order by m.cree_le desc, m.id desc limit 20
      ) x
    ), '[]'::jsonb)
  )
  from comptes k where k.id = p_compte;
$$;

create function regler_rappel_cagnotte(p_compte uuid, p_rappel boolean) returns boolean
language sql as $$
  update comptes set rappel_cagnotte = p_rappel where id = p_compte returning rappel_cagnotte;
$$;

-- ---------- Back-office ----------

-- Réglages de la rubrique Cagnotte et montant dû aux clients (pour la fiduciaire).
create function reglages_fidelite() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'active', fidelite_active(),
    'taux_pourcent', fidelite_taux(),
    'seuil_centimes', fidelite_seuil(),
    'soirs_doubles', coalesce((select valeur from reglages where cle = 'fidelite_soirs_doubles'), '{"jours": [], "dates": []}'::jsonb),
    'du_centimes', (select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements),
    'calcule_le', now(),
    'comptes', (select count(*) from (select compte_id from cagnotte_mouvements group by compte_id
                                      having sum(montant_centimes) > 0) x)
  );
$$;

-- Montant dû aux clients à la fin d'un jour (heure de Genève), pour le bilan de la fiduciaire (31.12) : somme des
-- mouvements jusqu'à minuit. { au, du_centimes, comptes }.
create function du_cagnottes_au(p_jour date) returns jsonb
language sql stable as $$
  with m as (
    select compte_id, sum(montant_centimes) as solde from cagnotte_mouvements
    where cree_le < ((p_jour + 1)::timestamp at time zone 'Europe/Zurich')
    group by compte_id
  )
  select jsonb_build_object('au', p_jour, 'du_centimes', coalesce((select sum(solde) from m), 0)::integer,
    'comptes', (select count(*) from m where solde > 0));
$$;

-- p : { taux_pourcent (3 à 10), seuil_centimes (0 à 5000), soirs_doubles: { jours: [1..7], dates: ['AAAA-MM-JJ'] } }.
create function regler_fidelite(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant jsonb := reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le';
  t integer := (p ->> 'taux_pourcent')::integer;
  s integer := (p ->> 'seuil_centimes')::integer;
  jours jsonb := coalesce(p #> '{soirs_doubles,jours}', '[]'::jsonb);
  dates jsonb := coalesce(p #> '{soirs_doubles,dates}', '[]'::jsonb);
begin
  if t is null or t not between 3 and 10 then
    raise exception 'fidelite_refusee:taux';
  end if;
  if s is null or s not between 0 and 5000 then
    raise exception 'fidelite_refusee:seuil';
  end if;
  if jsonb_typeof(jours) <> 'array' or jsonb_typeof(dates) <> 'array' or jsonb_array_length(dates) > 60
     or exists (select 1 from jsonb_array_elements(jours) j where jsonb_typeof(j) <> 'number' or (j #>> '{}')::integer not between 1 and 7)
     or exists (select 1 from jsonb_array_elements_text(dates) d where d !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'fidelite_refusee:soirs';
  end if;
  update reglages set valeur = to_jsonb(t) where cle = 'fidelite_taux_pourcent';
  update reglages set valeur = to_jsonb(s) where cle = 'fidelite_seuil_centimes';
  update reglages set valeur = jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(distinct (j #>> '{}')::integer), '[]'::jsonb) from jsonb_array_elements(jours) j),
      'dates', (select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb) from jsonb_array_elements_text(dates) d))
    where cle = 'fidelite_soirs_doubles';
  perform journaliser(p_personnel, 'fidelite', 'reglages', avant, reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le');
  return reglages_fidelite();
end;
$$;

-- Fiche d'un client du back-office (un client est un e-mail) : solde et mouvements, avec l'auteur des ajustements.
-- null : pas de compte pour cet e-mail.
create function cagnotte_client_gestion(p_email text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'solde_centimes', solde_cagnotte(k.id),
    'expire_le', case when solde_cagnotte(k.id) > 0
      then to_char((activite_cagnotte(k.id) + interval '12 months') at time zone 'Europe/Zurich', 'YYYY-MM-DD') end,
    'mouvements', coalesce((
      select jsonb_agg(jsonb_build_object('type', m.type, 'montant_centimes', m.montant_centimes, 'numero', o.numero,
        'motif', m.motif, 'par', m.par, 'cree_le', m.cree_le) order by m.cree_le desc, m.id desc)
      from cagnotte_mouvements m left join commandes o on o.id = m.commande_id where m.compte_id = k.id
    ), '[]'::jsonb)
  )
  from comptes k where k.email = lower(btrim(coalesce(p_email, '')));
$$;

-- Ajustement manuel par le gérant : montant de −CHF 100 à +CHF 100 (jamais 0), motif obligatoire, journalisé avec
-- l'auteur. Un retrait ne rend jamais le solde négatif. Rend le nouveau solde.
create function ajuster_cagnotte(p_email text, p_montant integer, p_motif text, p_personnel uuid) returns integer
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  k comptes%rowtype;
  m text := btrim(coalesce(p_motif, ''));
  avant integer;
begin
  if p_montant is null or p_montant = 0 or abs(p_montant) > 10000 then
    raise exception 'ajustement_refuse:montant';
  end if;
  if length(m) not between 3 and 200 then
    raise exception 'ajustement_refuse:motif';
  end if;
  select * into k from comptes where email = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    raise exception 'ajustement_refuse:compte';
  end if;
  avant := solde_cagnotte(k.id);
  if avant + p_montant < 0 then
    raise exception 'ajustement_refuse:negatif';
  end if;
  insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif, par)
    values (k.id, 'ajustement', p_montant, m, auteur);
  -- La clé du journal est l'identifiant du compte, pas son e-mail.
  perform journaliser(p_personnel, 'cagnotte', k.id::text, jsonb_build_object('solde_centimes', avant),
    jsonb_build_object('solde_centimes', avant + p_montant, 'montant_centimes', p_montant, 'motif', m));
  return avant + p_montant;
end;
$$;

-- ---------- Export du compte (nLPD) ----------

create or replace function export_compte(p_compte uuid, p_ip_court text) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  select jsonb_build_object(
    'export_le', now(),
    'compte', jsonb_build_object('email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone, 'cree_le', c.cree_le, 'modifie_le', c.modifie_le),
    'adresses', coalesce((
      select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'details', a.details, 'utilisee_le', a.utilisee_le) order by a.utilisee_le desc)
      from adresses_compte a where a.compte_id = c.id
    ), '[]'::jsonb),
    'commandes', coalesce((
      select jsonb_agg(
        (case when o.rangee_par_email then commande_rangee_export(o)
          else to_jsonb(o) - 'cle_idempotence' - 'origine' - 'compte_id' - 'stripe_session_id' end) || jsonb_build_object(
          'lignes', coalesce((
            select jsonb_agg(to_jsonb(l) - 'id' - 'commande_id' order by l.position)
            from commande_lignes l where l.commande_id = o.id
          ), '[]'::jsonb)
        ) order by o.cree_le desc)
      from commandes o where o.compte_id = c.id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('ouverte_le', s.cree_le, 'expire_le', s.expire_le, 'fermee_le', s.revoquee_le) order by s.cree_le desc)
      from sessions_compte s where s.compte_id = c.id
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('evenement', j.evenement, 'le', j.le) order by j.le desc)
      from journal_connexions j where j.compte_id = c.id
    ), '[]'::jsonb),
    -- Cagnotte (vague 3) : solde, rappel et tous les mouvements, sans l'auteur d'un ajustement.
    'cagnotte', jsonb_build_object(
      'solde_centimes', solde_cagnotte(c.id),
      'rappel_avant_expiration', c.rappel_cagnotte,
      'mouvements', coalesce((
        select jsonb_agg(jsonb_build_object('type', m.type, 'montant_centimes', m.montant_centimes, 'numero', o.numero,
          'motif', m.motif, 'le', m.cree_le) order by m.cree_le desc, m.id desc)
        from cagnotte_mouvements m left join commandes o on o.id = m.commande_id where m.compte_id = c.id
      ), '[]'::jsonb)
    )
  ) into r
  from comptes c where c.id = p_compte;
  if r is not null then
    insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'export', p_ip_court);
  end if;
  return r;
end;
$$;

revoke execute on function fidelite_active(), fidelite_entier(text, integer), fidelite_taux(), fidelite_seuil(),
  solde_cagnotte(uuid), taux_cagnotte(commandes), remise_plats(commandes), base_cagnotte(commandes),
  crediter_cagnotte(uuid), rendre_cagnotte(uuid), ajuster_gain(uuid), cagnotte_au_statut(), cagnotte_au_remboursement(),
  creer_commande_paiement(jsonb, text, integer), activite_cagnotte(uuid), expirer_cagnottes(), rappels_cagnotte_dus(),
  cagnotte_compte(uuid), regler_rappel_cagnotte(uuid, boolean), reglages_fidelite(), regler_fidelite(jsonb, uuid),
  cagnotte_client_gestion(text), ajuster_cagnotte(text, integer, text, uuid), du_cagnottes_au(date)
  from public, anon, authenticated;
grant execute on function fidelite_active(), fidelite_entier(text, integer), fidelite_taux(), fidelite_seuil(),
  solde_cagnotte(uuid), taux_cagnotte(commandes), remise_plats(commandes), base_cagnotte(commandes),
  crediter_cagnotte(uuid), rendre_cagnotte(uuid), ajuster_gain(uuid),
  creer_commande_paiement(jsonb, text, integer), activite_cagnotte(uuid), expirer_cagnottes(), rappels_cagnotte_dus(),
  cagnotte_compte(uuid), regler_rappel_cagnotte(uuid, boolean), reglages_fidelite(), regler_fidelite(jsonb, uuid),
  cagnotte_client_gestion(text), ajuster_cagnotte(text, integer, text, uuid), du_cagnottes_au(date)
  to service_role;
