-- Vague 3, pilotage : export des écritures pour Crésus Comptabilité (Epsitec), décision D9 de Jérémy
-- (13.11.2026 : « On fait la compta nous-mêmes avec Crésus », taux 2,6 % confirmé). Doc : docs/pilotage.md.
--
-- Plan de comptes proposé, à confirmer avec la personne qui tient la comptabilité : rangé dans reglages_prives
-- (lu par le serveur seulement), réglable par le gérant, chaque changement journalisé (objet « plan_comptes »).
-- « confirme » passe à vrai au premier enregistrement par le gérant ; avant, l'écran le marque « à confirmer ».
--
-- export_cresus : mêmes règles que export_recap_jours (20261129120000_export_compta.sql), pour que le fichier
-- Crésus et le récapitulatif tombent juste : une vente au jour de la commande (jour), un remboursement fait au
-- jour civil où il est fait (heure de Genève), sans ceux d'une commande refusée ou annulée. En plus, le moyen :
-- en ligne (Stripe, TWINT et cartes ensemble, la base ne les distingue pas), comptoir en espèces, comptoir à la
-- carte (commandes.moyen_comptoir, 20261203090000). Comptoir non noté : compté en espèces. Un manque déduit
-- au comptoir sort du moyen de la commande. Lecture seule, aucune donnée personnelle, service_role seul.

insert into reglages_prives (cle, valeur) values ('plan_comptes_cresus', jsonb_build_object(
  'confirme', false,
  'comptes', jsonb_build_object(
    'caisse', '1000',
    'stripe', '1090',
    'terminal', '1091',
    'tva', '2200',
    'ventes', '3200',
    'livraison', '3400',
    'remboursements', '3800'
  )
)) on conflict (cle) do nothing;

create function plan_comptes_cresus() returns jsonb
language sql stable as $$
  select valeur from reglages_prives where cle = 'plan_comptes_cresus';
$$;

-- Le gérant enregistre le plan entier : sept numéros de compte, chiffres seulement (1 à 10), deux rôles ne
-- partagent pas un compte. Une ligne de journal par compte changé.
create function regler_plan_comptes_cresus(p_comptes jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  roles constant text[] := array['caisse', 'stripe', 'terminal', 'tva', 'ventes', 'livraison', 'remboursements'];
  avant jsonb;
  r text;
  v text;
begin
  if p_comptes is null or jsonb_typeof(p_comptes) <> 'object'
     or (select count(*) from jsonb_object_keys(p_comptes)) <> array_length(roles, 1)
     or exists (select 1 from jsonb_object_keys(p_comptes) k where k <> all (roles)) then
    raise exception 'plan_invalide';
  end if;
  foreach r in array roles loop
    if jsonb_typeof(p_comptes -> r) <> 'string' or (p_comptes ->> r) !~ '^[0-9]{1,10}$' then
      raise exception 'compte_invalide:%', r;
    end if;
  end loop;
  if (select count(distinct value) from jsonb_each_text(p_comptes)) <> array_length(roles, 1) then
    raise exception 'compte_double';
  end if;
  select valeur -> 'comptes' into avant from reglages_prives where cle = 'plan_comptes_cresus' for update;
  update reglages_prives set valeur = jsonb_build_object('confirme', true, 'comptes', p_comptes), modifie_le = now()
    where cle = 'plan_comptes_cresus';
  foreach r in array roles loop
    v := p_comptes ->> r;
    if avant is null or avant ->> r is distinct from v then
      insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
        values (p_personnel, qui, 'plan_comptes', r, avant -> r, to_jsonb(v));
    end if;
  end loop;
  return plan_comptes_cresus();
end;
$$;

create function export_cresus(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, o.taux_tva_pourcent as taux,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      o.total_centimes, o.tva_centimes, o.frais_centimes,
      round(o.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva_frais
    from commandes o
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, o.taux_tva_pourcent as taux,
      case when r.moyen = 'stripe' then 'stripe' when r.moyen = 'especes' then 'caisse'
           when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      r.montant_centimes,
      round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux, 'vente' as sorte, moyen, count(*) as nombre, sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      sum(frais_centimes) as frais, sum(tva_frais) as tva_frais
    from ventes group by jour, taux, moyen
    union all
    select jour, taux, 'remboursement', moyen, count(*), sum(montant_centimes), sum(tva), 0, 0
    from rembs group by jour, taux, moyen
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', jour, 'taux_tva_pourcent', taux, 'sorte', sorte, 'moyen', moyen, 'nombre', nombre,
    'ttc_centimes', ttc, 'tva_centimes', tva, 'frais_centimes', frais, 'tva_frais_centimes', tva_frais
  ) order by jour, sorte desc, moyen, taux), '[]'::jsonb)
  from lignes;
$$;

revoke execute on function plan_comptes_cresus(), regler_plan_comptes_cresus(jsonb, uuid), export_cresus(date, date) from public, anon, authenticated;
grant execute on function plan_comptes_cresus(), regler_plan_comptes_cresus(jsonb, uuid), export_cresus(date, date) to service_role;
