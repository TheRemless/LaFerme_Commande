-- Vague 3, pilotage : export pour la fiduciaire, une ligne par jour et par taux de TVA, et liste des
-- remboursements à suivre. Lecture seule, service_role seul, aucune donnée personnelle.
--
-- Mêmes règles que export_ventes et export_remboursements (dernières définitions dans
-- 20261114090000_correctifs_gerant.sql et 20261117090000_gerant_vague2.sql), pour que le récapitulatif et le
-- détail tombent juste : une vente compte au jour de la commande (jour), un remboursement fait au jour civil
-- où il est fait (heure de Genève), sans ceux d'une commande refusée ou annulée. TVA d'un remboursement :
-- arrondie remboursement par remboursement, comme le détail.
-- Format par défaut tant que la fiduciaire n'a pas dit quel logiciel et quel plan de comptes (question D9) :
-- aucun numéro de compte, seulement des montants que tout logiciel ou tableur reprend.

create function export_recap_jours(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, o.taux_tva_pourcent as taux, o.moyen_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes
    from commandes o
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, o.taux_tva_pourcent as taux, r.moyen, r.montant_centimes,
      round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux,
      count(*) as ventes, sum(total_centimes) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      sum(total_centimes) filter (where moyen_paiement = 'comptoir') as comptoir, sum(frais_centimes) as frais,
      sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      0 as remb_stripe, 0 as remb_especes, 0 as remb_deduction, 0 as tva_remb
    from ventes group by jour, taux
    union all
    select jour, taux, 0, 0, 0, 0, 0, 0,
      sum(montant_centimes) filter (where moyen = 'stripe'), sum(montant_centimes) filter (where moyen = 'especes'),
      sum(montant_centimes) filter (where moyen = 'deduction'), sum(tva)
    from rembs group by jour, taux
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', x.jour, 'taux_tva_pourcent', x.taux, 'ventes', x.ventes,
    'en_ligne_centimes', x.en_ligne, 'comptoir_centimes', x.comptoir, 'frais_centimes', x.frais, 'ttc_centimes', x.ttc,
    'tva_centimes', x.tva,
    'rembourse_en_ligne_centimes', x.remb_stripe, 'rembourse_especes_centimes', x.remb_especes,
    'deduit_centimes', x.remb_deduction, 'tva_remboursee_centimes', x.tva_remb,
    'net_ttc_centimes', x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction,
    'net_tva_centimes', x.tva - x.tva_remb,
    'net_ht_centimes', (x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction) - (x.tva - x.tva_remb)
  ) order by x.jour, x.taux), '[]'::jsonb)
  from (
    select jour, taux,
      sum(ventes)::bigint as ventes, coalesce(sum(en_ligne), 0)::bigint as en_ligne, coalesce(sum(comptoir), 0)::bigint as comptoir,
      coalesce(sum(frais), 0)::bigint as frais, coalesce(sum(ttc), 0)::bigint as ttc, coalesce(sum(tva), 0)::bigint as tva,
      coalesce(sum(remb_stripe), 0)::bigint as remb_stripe, coalesce(sum(remb_especes), 0)::bigint as remb_especes,
      coalesce(sum(remb_deduction), 0)::bigint as remb_deduction, coalesce(sum(tva_remb), 0)::bigint as tva_remb
    from lignes group by jour, taux
  ) x;
$$;

-- Remboursements à suivre : en échec (l'argent n'est pas rendu au client), ou demandés à Stripe il y a plus
-- de p_heures heures sans confirmation. Les plus anciens d'abord. L'identifiant de la commande sert au lien
-- vers sa fiche dans le back-office.
create function remboursements_a_suivre(p_heures integer default 24) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'commande_id', r.commande_id, 'numero', o.numero, 'jour', o.jour_service, 'statut', r.statut,
    'montant_centimes', r.montant_centimes, 'moyen', r.moyen, 'motif', r.motif, 'erreur', r.erreur,
    'par', r.personnel_nom, 'cree_le', r.cree_le, 'commande_refusee', o.statut = 'refusee'
  ) order by r.cree_le), '[]'::jsonb)
  from remboursements r join commandes o on o.id = r.commande_id
  where r.statut = 'echec'
     or (r.statut = 'en_cours' and r.cree_le < now() - make_interval(hours => greatest(coalesce(p_heures, 24), 1)));
$$;

revoke execute on function export_recap_jours(date, date), remboursements_a_suivre(integer) from public, anon, authenticated;
grant execute on function export_recap_jours(date, date), remboursements_a_suivre(integer) to service_role;
