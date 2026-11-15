-- Vague 3, client-compte : parrainage (programme de fidélité validé par Jérémy le 15.11.2026). Sous l'interrupteur de la
-- cagnotte (fidelite_active), construit éteint.
--
-- Règles :
-- - chaque compte a un lien personnel /parrain/<code> (le code seul, aucune donnée du client) ;
-- - un filleul est un nouveau compte : son e-mail n'a jamais commandé ni eu de compte ; un seul parrain ; pas
--   d'auto-parrainage ; au plus N parrainages par compte et par mois (10, réglable) ;
-- - CHF 10 (réglable) au parrain et au filleul, crédités dans leur cagnotte après la première commande livrée ou
--   retirée du filleul. À ce moment, la base revérifie que le téléphone et l'adresse de livraison de cette commande
--   n'ont jamais été vus (ni chez le parrain, ni dans une autre commande) : sinon le parrainage est refusé, sans
--   crédit. Même normalisation que la « première commande » des codes promo (telephone_normal, adresse_cle).
--
-- Objets recréés (20261216090000_cagnotte.sql, client-compte) : cagnotte_au_statut avec l'appel au parrainage,
-- reglages_fidelite et regler_fidelite avec le montant et le plafond du parrainage.
-- Ajouts sur des tables partagées : comptes.code_parrainage, deux réglages.

insert into reglages (cle, valeur, proposition) values
  ('parrainage_montant_centimes', '1000', false),
  ('parrainage_plafond_mois', '10', false)
  on conflict (cle) do nothing;

alter table comptes add column code_parrainage text unique check (code_parrainage ~ '^[A-HJ-NP-Z2-9]{8}$');

create table parrainages (
  id uuid primary key default gen_random_uuid(),
  parrain_id uuid not null references comptes (id) on delete cascade,
  filleul_id uuid not null unique references comptes (id) on delete cascade,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'credite', 'refuse')),
  raison text,
  commande_id uuid references commandes (id) on delete set null,
  cree_le timestamptz not null default now(),
  termine_le timestamptz
);
create index parrainages_parrain_idx on parrainages (parrain_id, cree_le);
alter table parrainages enable row level security;
revoke all on parrainages from anon, authenticated;
grant select, insert, update on parrainages to service_role;

-- Code personnel, créé au premier besoin : 8 caractères sans 0, O, 1 ni I.
create function code_parrainage(p_compte uuid) returns text
language plpgsql as $$
declare
  c text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select code_parrainage into c from comptes where id = p_compte;
  if c is not null then
    return c;
  end if;
  loop
    c := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1), '') from generate_series(1, 8));
    begin
      update comptes set code_parrainage = c where id = p_compte and code_parrainage is null;
      return (select code_parrainage from comptes where id = p_compte);
    exception when unique_violation then
      -- Code déjà pris : on en tire un autre.
    end;
  end loop;
end;
$$;

-- Clés de comparaison anti-fraude (revue de sécurité) :
-- - téléphone : les 9 derniers chiffres, « (0) » retiré (+41 (0)79…, 0041 79…, 079… donnent la même clé) ;
-- - e-mail : sans « +étiquette », et sans points pour Gmail (une même boîte).
create function tel_cle(p text) returns text
language sql immutable as $$
  select case when length(d) >= 9 then right(d, 9) else '' end
  from (select regexp_replace(replace(coalesce(p, ''), '(0)', ''), '\D', '', 'g') as d) x;
$$;

create function email_cle(p text) returns text
language sql immutable as $$
  select case when dom in ('gmail.com', 'googlemail.com') then replace(loc, '.', '') || '@gmail.com' else loc || '@' || dom end
  from (select split_part(split_part(e, '@', 1), '+', 1) as loc, split_part(e, '@', 2) as dom
        from (select lower(btrim(coalesce(p, ''))) as e) y) x;
$$;

-- Rattache un compte qui vient d'être créé à son parrain. Rend 'ok' ou la raison du refus : desactive, code,
-- soi_meme, deja, ancien (compte de plus de 24 heures, qui a déjà commandé, ou boîte e-mail déjà vue), plafond.
create function lier_parrainage(p_email text, p_code text) returns text
language plpgsql as $$
declare
  f comptes%rowtype;
  parrain uuid;
  debut_mois timestamptz := date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  if not fidelite_active() then
    return 'desactive';
  end if;
  select id into parrain from comptes where code_parrainage = upper(btrim(coalesce(p_code, '')));
  if parrain is null then
    return 'code';
  end if;
  select * into f from comptes where email = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    return 'code';
  end if;
  if f.id = parrain then
    return 'soi_meme';
  end if;
  if exists (select 1 from parrainages where filleul_id = f.id) then
    return 'deja';
  end if;
  -- Client nouveau : compte de moins de 24 heures, aucune commande avec ce compte ni avec cet e-mail (Gmail sans
  -- points, sans « +étiquette »), aucun autre compte sur la même boîte.
  if f.cree_le < now() - interval '24 hours'
     or exists (select 1 from commandes where compte_id = f.id)
     or exists (select 1 from commandes where email_cle(client_email) = email_cle(f.email))
     or exists (select 1 from comptes k where k.id <> f.id and email_cle(k.email) = email_cle(f.email)) then
    return 'ancien';
  end if;
  perform 1 from comptes where id = parrain for update;
  if (select count(*) from parrainages where parrain_id = parrain and cree_le >= debut_mois)
     >= greatest(fidelite_entier('parrainage_plafond_mois', 10), 0) then
    return 'plafond';
  end if;
  insert into parrainages (parrain_id, filleul_id) values (parrain, f.id);
  return 'ok';
end;
$$;

-- À la première commande livrée ou retirée du filleul : CHF 10 à chacun, ou refus si le téléphone ou l'adresse de
-- cette commande ont déjà été vus (chez le parrain ou dans une autre commande). Une seule fois par filleul.
create function crediter_parrainage(p_commande uuid) returns text
language plpgsql as $$
declare
  o commandes%rowtype;
  p parrainages%rowtype;
  tels text[];
  adr text;
  montant integer := greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0);
  v_raison text;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null
     or o.motif is not distinct from 'Client absent à la livraison.' or not fidelite_active() then
    return null;
  end if;
  select * into p from parrainages where filleul_id = o.compte_id and statut = 'en_attente' for update;
  if not found then
    return null;
  end if;
  -- Téléphones de la commande : le client et la personne qui reçoit (revue de sécurité).
  tels := array_remove(array[tel_cle(o.client_telephone), tel_cle(o.destinataire ->> 'telephone')], '');
  adr := case when o.mode = 'livraison' then adresse_cle(o.adresse) end;
  -- Pas encore encaissée (comptoir) : on attend l'encaissement, qui rappelle cette fonction. Remboursée : refus.
  if o.statut_paiement in ('a_encaisser_retrait', 'en_attente') then
    return null;
  end if;
  if o.statut_paiement not in ('paye', 'encaisse')
     or exists (select 1 from remboursements r where r.commande_id = o.id and r.statut in ('en_cours', 'fait')) then
    v_raison := 'paiement';
  elsif exists (select 1 from commandes x where x.compte_id = o.compte_id and x.id <> o.id and x.statut = 'terminee') then
    v_raison := 'pas_premiere';
  elsif cardinality(tels) > 0 and (
       exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id
               and x.statut not in ('paiement_en_attente', 'annulee')
               and (tel_cle(x.client_telephone) = any(tels) or tel_cle(x.destinataire ->> 'telephone') = any(tels)))
       or exists (select 1 from comptes k where k.id = p.parrain_id and tel_cle(k.telephone) = any(tels))) then
    v_raison := 'telephone';
  elsif adr is not null and exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and x.mode = 'livraison'
               and adresse_cle(x.adresse) = adr and x.statut not in ('paiement_en_attente', 'annulee')) then
    v_raison := 'adresse';
  end if;
  if v_raison is not null then
    update parrainages set statut = 'refuse', raison = v_raison, commande_id = o.id, termine_le = now() where id = p.id;
    return v_raison;
  end if;
  update parrainages set statut = 'credite', commande_id = o.id, termine_le = now() where id = p.id;
  if montant > 0 then
    insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
      values (p.parrain_id, o.id, 'parrainage', montant, 'Parrainage d''un proche'),
             (o.compte_id, o.id, 'parrainage', montant, 'Bienvenue par parrainage');
  end if;
  return 'credite';
end;
$$;

-- Commande du filleul remboursée en entier après le crédit : les deux crédits sont repris, au plus le solde de
-- chaque compte (jamais négatif). Le parrainage passe « refuse ».
create function reprendre_parrainage(p_commande uuid) returns integer
language plpgsql as $$
declare
  m record;
  n integer := 0;
  r integer;
begin
  for m in select compte_id, sum(montant_centimes)::integer as total from cagnotte_mouvements
           where commande_id = p_commande and type = 'parrainage' group by compte_id having sum(montant_centimes) > 0
  loop
    perform 1 from comptes where id = m.compte_id for update;
    r := least(m.total, greatest(solde_cagnotte(m.compte_id), 0));
    if r > 0 then
      insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
        values (m.compte_id, p_commande, 'parrainage', -r, 'Parrainage repris, commande remboursée');
      n := n + 1;
    end if;
  end loop;
  update parrainages set statut = 'refuse', raison = 'rembourse', termine_le = now() where commande_id = p_commande and statut = 'credite';
  return n;
end;
$$;

create or replace function cagnotte_au_statut() returns trigger
language plpgsql as $$
begin
  -- À la remise, ou à l'encaissement d'une commande déjà remise (relecture de qualite) : gain et parrainage.
  if (new.statut = 'terminee' and old.statut is distinct from 'terminee')
     or (new.statut = 'terminee' and new.statut_paiement in ('paye', 'encaisse') and old.statut_paiement is distinct from new.statut_paiement) then
    perform crediter_cagnotte(new.id);
    perform crediter_parrainage(new.id);
  end if;
  -- La cagnotte utilisée revient seulement si la commande n'a pas eu lieu : refusée, annulée, paiement échoué.
  -- Un remboursement après coup (plats retirés, geste) ne rend que de l'argent, au plus ce qui a été payé : passer
  -- « remboursée » quand l'argent payé est rendu ne rend pas la cagnotte (revue de sécurité). Le gain, lui, est
  -- recalculé à chaque remboursement fait (cagnotte_au_remboursement).
  if (new.statut in ('refusee', 'annulee') and old.statut is distinct from new.statut)
     or (new.statut_paiement = 'echec' and old.statut_paiement is distinct from 'echec') then
    perform rendre_cagnotte(new.id);
    perform ajuster_gain(new.id);
  elsif new.statut_paiement = 'rembourse' and old.statut_paiement is distinct from 'rembourse' then
    perform ajuster_gain(new.id);
    perform reprendre_parrainage(new.id);
  end if;
  return null;
end;
$$;

-- Parrainage du compte : { actif, code, montant_centimes, credites, en_attente, parraine: 'en_attente' | 'credite' |
-- 'refuse' | null }. Jamais l'identité de l'autre personne.
create function parrainage_compte(p_compte uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'actif', fidelite_active(),
    'code', case when fidelite_active() then code_parrainage(p_compte) end,
    'montant_centimes', greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0),
    'credites', (select count(*) from parrainages where parrain_id = p_compte and statut = 'credite'),
    'en_attente', (select count(*) from parrainages where parrain_id = p_compte and statut = 'en_attente'),
    'parraine', (select statut from parrainages where filleul_id = p_compte)
  );
$$;

-- Réglages de la rubrique Cagnotte, avec le parrainage.
create or replace function reglages_fidelite() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'active', fidelite_active(),
    'taux_pourcent', fidelite_taux(),
    'seuil_centimes', fidelite_seuil(),
    'soirs_doubles', coalesce((select valeur from reglages where cle = 'fidelite_soirs_doubles'), '{"jours": [], "dates": []}'::jsonb),
    'du_centimes', (select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements),
    'calcule_le', now(),
    'parrainage_montant_centimes', greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0),
    'parrainage_plafond_mois', greatest(fidelite_entier('parrainage_plafond_mois', 10), 0),
    'comptes', (select count(*) from (select compte_id from cagnotte_mouvements group by compte_id
                                      having sum(montant_centimes) > 0) x)
  );
$$;

create or replace function regler_fidelite(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant jsonb := reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le';
  t integer := (p ->> 'taux_pourcent')::integer;
  s integer := (p ->> 'seuil_centimes')::integer;
  jours jsonb := coalesce(p #> '{soirs_doubles,jours}', '[]'::jsonb);
  dates jsonb := coalesce(p #> '{soirs_doubles,dates}', '[]'::jsonb);
  pm integer := coalesce((p ->> 'parrainage_montant_centimes')::integer, fidelite_entier('parrainage_montant_centimes', 1000));
  pp integer := coalesce((p ->> 'parrainage_plafond_mois')::integer, fidelite_entier('parrainage_plafond_mois', 10));
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
  if pm is null or pm not between 0 and 5000 or pp is null or pp not between 0 and 100 then
    raise exception 'fidelite_refusee:parrainage';
  end if;
  update reglages set valeur = to_jsonb(t) where cle = 'fidelite_taux_pourcent';
  update reglages set valeur = to_jsonb(pm) where cle = 'parrainage_montant_centimes';
  update reglages set valeur = to_jsonb(pp) where cle = 'parrainage_plafond_mois';
  update reglages set valeur = to_jsonb(s) where cle = 'fidelite_seuil_centimes';
  update reglages set valeur = jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(distinct (j #>> '{}')::integer), '[]'::jsonb) from jsonb_array_elements(jours) j),
      'dates', (select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb) from jsonb_array_elements_text(dates) d))
    where cle = 'fidelite_soirs_doubles';
  perform journaliser(p_personnel, 'fidelite', 'reglages', avant, reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le');
  return reglages_fidelite();
end;
$$;

revoke execute on function code_parrainage(uuid), lier_parrainage(text, text), crediter_parrainage(uuid), parrainage_compte(uuid),
  tel_cle(text), email_cle(text), reprendre_parrainage(uuid)
  from public, anon, authenticated;
grant execute on function code_parrainage(uuid), lier_parrainage(text, text), crediter_parrainage(uuid), parrainage_compte(uuid),
  tel_cle(text), email_cle(text), reprendre_parrainage(uuid)
  to service_role;
