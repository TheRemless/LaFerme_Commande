-- Vague 3, bo-pilotage : comptes justes au droit suisse (demande de Jérémy du 19.11.2026), PR 1 du plan
-- docs/compta/plan-conformite.md. Règles R11, R14, R30 à R32 de docs/compta/tva-et-cagnotte.md.
--
-- 1. Contrat partagé de ventilation par taux. ventilation_commande et ventilation_remboursement donnent les montants
--    par taux. Aujourd'hui un seul taux, celui de la commande. bo-carte les recrée (create or replace, mêmes
--    signatures, même forme) quand les lignes portent leur taux. La compta lit ces fonctions, pas taux_tva_pourcent.
-- 2. Avoir numéroté par remboursement fait (R11) : remboursements.numero_avoir, donné une fois, dans l'ordre où les
--    remboursements sont faits, jamais réutilisé. Ajout seul sur une table partagée (colonne, séquence, déclencheur).
-- 3. Plan de comptes Crésus : deux rôles de plus (rabais, cagnotte, R14) et les codes TVA du dossier par taux (R32),
--    vides tant que le gérant ne les a pas recopiés de sa table TVA Crésus. Objet recréé : regler_plan_comptes_cresus
--    (depuis 20261214120000_export_cresus.sql), même signature.
-- 4. export_cresus_etendu : ventes au brut par jour, moyen et taux, avec rabais (codes promo) et cagnotte utilisée à
--    part, et un avoir par remboursement. Mêmes règles que export_cresus (dernière définition :
--    20261216140000_remboursement_terminal.sql), qui reste pour le format simple.
-- Lecture et réglage réservés au serveur (service_role), aucune donnée personnelle.

-- ---------- 1. Ventilation par taux ----------

-- [{ taux, ttc, tva, frais_ttc, frais_tva, rabais_ttc, rabais_tva, cagnotte_ttc, cagnotte_tva }] : ttc et tva sont le
-- payé net à ce taux (somme des ttc = total_centimes, somme des tva = tva_centimes). Le rabais (code promo) et la
-- cagnotte utilisée sont la part déduite à ce taux, leur TVA arrondie au centime à part : la TVA au brut vaut
-- tva + rabais_tva + cagnotte_tva, exacte par construction.
create function ventilation_commande(o commandes) returns jsonb
language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'taux', o.taux_tva_pourcent,
    'ttc', o.total_centimes,
    'tva', o.tva_centimes,
    'frais_ttc', o.frais_centimes,
    'frais_tva', round(o.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer,
    'rabais_ttc', o.remise_centimes,
    'rabais_tva', round(o.remise_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer,
    'cagnotte_ttc', o.cagnotte_centimes,
    'cagnotte_tva', round(o.cagnotte_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer
  ));
$$;

-- [{ taux, ttc, tva }] : somme des ttc = montant_centimes. Aujourd'hui au taux de la commande (même arrondi que
-- export_recap_jours) ; bo-carte : par article quand elements les donne, sinon selon la clé fixée par la fiduciaire.
create function ventilation_remboursement(r remboursements) returns jsonb
language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'taux', o.taux_tva_pourcent,
    'ttc', r.montant_centimes,
    'tva', round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer
  ))
  from commandes o where o.id = r.commande_id;
$$;

-- ---------- 2. Avoirs numérotés ----------

create sequence numeros_avoir;
revoke all on sequence numeros_avoir from public, anon, authenticated;
grant usage on sequence numeros_avoir to service_role;
alter table remboursements add column numero_avoir integer unique;

-- Remboursements déjà faits : numérotés dans l'ordre où ils ont été faits.
update remboursements r set numero_avoir = x.n
from (select id, nextval('numeros_avoir')::integer as n from (select id from remboursements where statut = 'fait' order by fait_le, cree_le, id) t) x
where r.id = x.id;

create function numeroter_avoir() returns trigger
language plpgsql as $$
begin
  if new.statut = 'fait' and new.numero_avoir is null then
    new.numero_avoir := nextval('numeros_avoir');
  end if;
  return new;
end;
$$;
create trigger remboursements_avoir before insert or update of statut on remboursements
  for each row execute function numeroter_avoir();

-- ---------- 3. Plan de comptes : rabais, cagnotte, codes TVA ----------

-- Comptes proposés, à confirmer (docs/pilotage.md) : rabais accordés et cagnotte utilisée en diminution de recettes.
-- Codes TVA : vides, à recopier de la table TVA du dossier Crésus (jamais devinés). Rien ne change pour un plan
-- déjà confirmé, sauf ces ajouts.
update reglages_prives set valeur = jsonb_set(jsonb_set(valeur, '{comptes}', (valeur -> 'comptes') || jsonb_build_object(
    'rabais', coalesce(valeur -> 'comptes' ->> 'rabais', '3801'),
    'cagnotte', coalesce(valeur -> 'comptes' ->> 'cagnotte', '3802'))),
  '{codes_tva}', coalesce(valeur -> 'codes_tva', jsonb_build_object('2.6', '', '8.1', '')))
where cle = 'plan_comptes_cresus';

-- Le gérant enregistre le plan entier : neuf comptes (chiffres, 1 à 10, tous différents) et les codes TVA par taux
-- (lettres, chiffres, point, tiret, soulignement, 1 à 12 ; vide admis tant qu'aucun export étendu n'en a besoin).
-- Une ligne de journal par compte ou code changé.
create or replace function regler_plan_comptes_cresus(p_comptes jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  roles constant text[] := array['caisse', 'stripe', 'terminal', 'tva', 'ventes', 'livraison', 'remboursements', 'rabais', 'cagnotte'];
  comptes jsonb := p_comptes -> 'comptes';
  codes jsonb := p_comptes -> 'codes_tva';
  avant jsonb;
  r text;
  v text;
begin
  -- Ancienne forme (les comptes seuls, sept rôles) : refusée, l'écran envoie { comptes, codes_tva }.
  if comptes is null or jsonb_typeof(comptes) <> 'object'
     or (select count(*) from jsonb_object_keys(comptes)) <> array_length(roles, 1)
     or exists (select 1 from jsonb_object_keys(comptes) k where k <> all (roles)) then
    raise exception 'plan_invalide';
  end if;
  foreach r in array roles loop
    if jsonb_typeof(comptes -> r) <> 'string' or (comptes ->> r) !~ '^[0-9]{1,10}$' then
      raise exception 'compte_invalide:%', r;
    end if;
  end loop;
  if (select count(distinct value) from jsonb_each_text(comptes)) <> array_length(roles, 1) then
    raise exception 'compte_double';
  end if;
  if codes is null or jsonb_typeof(codes) <> 'object'
     or exists (select 1 from jsonb_each(codes) c where c.key !~ '^[0-9]{1,2}\.[0-9]$' or jsonb_typeof(c.value) <> 'string'
                or (c.value #>> '{}') !~ '^[A-Za-z0-9._-]{0,12}$') then
    raise exception 'codes_invalides';
  end if;
  select valeur into avant from reglages_prives where cle = 'plan_comptes_cresus' for update;
  update reglages_prives set valeur = jsonb_build_object('confirme', true, 'comptes', comptes, 'codes_tva', codes), modifie_le = now()
    where cle = 'plan_comptes_cresus';
  foreach r in array roles loop
    v := comptes ->> r;
    if avant -> 'comptes' ->> r is distinct from v then
      insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
        values (p_personnel, qui, 'plan_comptes', r, avant -> 'comptes' -> r, to_jsonb(v));
    end if;
  end loop;
  for r in select key from jsonb_each(codes) loop
    if avant -> 'codes_tva' ->> r is distinct from codes ->> r then
      insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
        values (p_personnel, qui, 'plan_comptes', 'code_tva_' || replace(r, '.', '_'), avant -> 'codes_tva' -> r, codes -> r);
    end if;
  end loop;
  return plan_comptes_cresus();
end;
$$;

-- ---------- 4. Export étendu ----------

-- { ventes: [{ jour, moyen, taux, nombre, ttc, tva, frais_ttc, frais_tva, rabais_ttc, rabais_tva, cagnotte_ttc,
--   cagnotte_tva }], avoirs: [{ numero_avoir, jour, moyen, commande, stripe_refund_id, ventilation }] }.
-- Ventes : jour de la commande, payées ou encaissées, ni refusées ni annulées, avec les compléments encaissés (sans
-- rabais ni cagnotte). Avoirs : jour civil du remboursement fait (heure de Genève), sans commande refusée ou annulée.
create function export_cresus_etendu(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with v as (
    select o.jour,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      x, false as complement
    from commandes o, jsonb_array_elements(ventilation_commande(o)) x
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
    union all
    select o.jour,
      case when k.moyen = 'en_ligne' then 'stripe' when k.moyen_encaissement = 'carte' then 'terminal' else 'caisse' end,
      jsonb_build_object('taux', o.taux_tva_pourcent, 'ttc', k.montant_centimes, 'tva', k.tva_centimes,
        'frais_ttc', k.frais_centimes,
        'frais_tva', round(k.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer,
        'rabais_ttc', 0, 'rabais_tva', 0, 'cagnotte_ttc', 0, 'cagnotte_tva', 0),
      true
    from complements k join commandes o on o.id = k.commande_id
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  ventes as (
    select jour, moyen, (x ->> 'taux')::numeric as taux, count(*) filter (where not complement) as nombre,
      sum((x ->> 'ttc')::bigint) as ttc, sum((x ->> 'tva')::bigint) as tva,
      sum((x ->> 'frais_ttc')::bigint) as frais_ttc, sum((x ->> 'frais_tva')::bigint) as frais_tva,
      sum((x ->> 'rabais_ttc')::bigint) as rabais_ttc, sum((x ->> 'rabais_tva')::bigint) as rabais_tva,
      sum((x ->> 'cagnotte_ttc')::bigint) as cagnotte_ttc, sum((x ->> 'cagnotte_tva')::bigint) as cagnotte_tva
    from v group by jour, moyen, (x ->> 'taux')::numeric
  ),
  avoirs as (
    select r.numero_avoir, (r.fait_le at time zone 'Europe/Zurich')::date as jour,
      case when r.moyen = 'stripe' then 'stripe' when r.moyen = 'especes' then 'caisse' when r.moyen = 'terminal' then 'terminal'
           when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      o.numero as commande, r.stripe_refund_id, ventilation_remboursement(r) as ventilation
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  )
  select jsonb_build_object(
    'ventes', coalesce((select jsonb_agg(jsonb_build_object(
      'jour', jour, 'moyen', moyen, 'taux', taux, 'nombre', nombre, 'ttc', ttc, 'tva', tva, 'frais_ttc', frais_ttc,
      'frais_tva', frais_tva, 'rabais_ttc', rabais_ttc, 'rabais_tva', rabais_tva, 'cagnotte_ttc', cagnotte_ttc,
      'cagnotte_tva', cagnotte_tva) order by jour, moyen, taux) from ventes), '[]'::jsonb),
    'avoirs', coalesce((select jsonb_agg(jsonb_build_object(
      'numero_avoir', numero_avoir, 'jour', jour, 'moyen', moyen, 'commande', commande,
      'stripe_refund_id', stripe_refund_id, 'ventilation', ventilation) order by jour, numero_avoir) from avoirs), '[]'::jsonb)
  );
$$;

revoke execute on function ventilation_commande(commandes), ventilation_remboursement(remboursements), export_cresus_etendu(date, date)
  from public, anon, authenticated;
grant execute on function ventilation_commande(commandes), ventilation_remboursement(remboursements), export_cresus_etendu(date, date)
  to service_role;
