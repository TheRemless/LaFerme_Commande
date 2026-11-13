-- Vague 3, pilotage : tableau des ventes calculé en base, pour une période et la période de comparaison.
-- Lecture seule, réservée au serveur (service_role), comme export_ventes et jours_gestion : la route vérifie
-- le gérant avant l'appel. Aucune donnée personnelle dans le résultat (ni nom, ni téléphone, ni e-mail).
--
-- Définitions (docs/back-office.md, « Chiffres ») :
-- - Le jour d'une commande est son jour de service (jour_service), comme dans la liste des commandes.
-- - Commande prise : ni refusée, ni annulée, ni en attente de paiement. Elle compte qu'elle soit encaissée
--   ou encore à encaisser au comptoir.
-- - TTC = total payé par le client, frais de livraison compris. HT = TTC moins la TVA de la commande.
-- - Remboursements faits : comptés au jour du remboursement (heure de Genève), comme l'export comptable,
--   sans ceux d'une commande refusée (elle n'a jamais été une vente). En cours et en échec : au jour de la
--   demande, refusées comprises (de l'argent qui n'est pas encore rendu au client).

-- Le remboursement d'un jour se cherche par instant (index remboursements_fait_idx), pas par date calculée.
create index remboursements_ouverts_idx on remboursements (cree_le) where statut in ('en_cours', 'echec');
create index remboursements_echec_idx on remboursements (statut) where statut = 'echec';

create function pilotage_synthese(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with prises as (
    select o.mode, o.moyen_paiement, o.statut_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, o.taux_tva_pourcent
    from commandes o
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
  ),
  refusees as (
    select o.total_centimes, coalesce(nullif(btrim(o.motif), ''), 'Sans motif') as motif
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut = 'refusee'
  ),
  faits as (
    select r.montant_centimes, r.moyen, o.taux_tva_pourcent
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  ouverts as (
    select r.statut, r.montant_centimes
    from remboursements r
    where r.statut in ('en_cours', 'echec')
      and r.cree_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.cree_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
  ),
  taux as (
    select t.taux, sum(t.ttc)::bigint as ttc, sum(t.tva)::bigint as tva, sum(t.rembourse)::bigint as rembourse, sum(t.tva_rembourse)::bigint as tva_rembourse
    from (
      select taux_tva_pourcent as taux, total_centimes as ttc, tva_centimes as tva, 0 as rembourse, 0 as tva_rembourse from prises
      union all
      select taux_tva_pourcent, 0, 0, montant_centimes,
        round(montant_centimes * taux_tva_pourcent / (100 + taux_tva_pourcent))::integer from faits
    ) t
    group by t.taux
  )
  select jsonb_build_object(
    'commandes', p.commandes,
    'ttc_centimes', p.ttc,
    'tva_centimes', p.tva,
    'ht_centimes', p.ttc - p.tva,
    'panier_moyen_centimes', case when p.commandes > 0 then round(p.ttc::numeric / p.commandes)::bigint else 0 end,
    'encaisse_centimes', p.encaisse,
    'a_encaisser', p.a_encaisser,
    'a_encaisser_centimes', p.a_encaisser_ttc,
    'frais_centimes', p.frais,
    'livraison', jsonb_build_object('commandes', p.livraisons, 'ttc_centimes', p.livraison_ttc),
    'retrait', jsonb_build_object('commandes', p.commandes - p.livraisons, 'ttc_centimes', p.ttc - p.livraison_ttc),
    'en_ligne', jsonb_build_object('commandes', p.en_ligne, 'ttc_centimes', p.en_ligne_ttc),
    'comptoir', jsonb_build_object('commandes', p.commandes - p.en_ligne, 'ttc_centimes', p.ttc - p.en_ligne_ttc),
    'refusees', jsonb_build_object(
      'commandes', (select count(*) from refusees),
      'ttc_centimes', (select coalesce(sum(total_centimes), 0) from refusees),
      'motifs', coalesce((
        select jsonb_agg(jsonb_build_object('motif', m.motif, 'commandes', m.n, 'ttc_centimes', m.ttc) order by m.n desc, m.motif)
        from (select min(motif) as motif, count(*) as n, sum(total_centimes) as ttc from refusees group by lower(motif) order by count(*) desc, min(motif) limit 8) m
      ), '[]'::jsonb)
    ),
    'remboursements', (
      select jsonb_build_object(
        'faits', (select count(*) from faits),
        'faits_centimes', (select coalesce(sum(montant_centimes), 0) from faits),
        'faits_en_ligne_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'stripe'), 0) from faits),
        'faits_especes_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'especes'), 0) from faits),
        'en_cours', count(*) filter (where statut = 'en_cours'),
        'en_cours_centimes', coalesce(sum(montant_centimes) filter (where statut = 'en_cours'), 0),
        'echecs', count(*) filter (where statut = 'echec'),
        'echecs_centimes', coalesce(sum(montant_centimes) filter (where statut = 'echec'), 0),
        -- Tous les échecs encore ouverts, quel que soit leur jour : l'argent dû au client ne sort pas du tableau.
        'echecs_ouverts', (select count(*) from remboursements where statut = 'echec'),
        'echecs_ouverts_centimes', (select coalesce(sum(montant_centimes), 0) from remboursements where statut = 'echec')
      )
      from ouverts
    ),
    'net_ttc_centimes', p.ttc - (select coalesce(sum(montant_centimes), 0) from faits),
    'tva', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taux_pourcent', t.taux, 'ttc_centimes', t.ttc, 'tva_centimes', t.tva, 'ht_centimes', t.ttc - t.tva,
        'rembourse_centimes', t.rembourse, 'tva_remboursee_centimes', t.tva_rembourse,
        'net_ttc_centimes', t.ttc - t.rembourse, 'net_tva_centimes', t.tva - t.tva_rembourse,
        'net_ht_centimes', (t.ttc - t.rembourse) - (t.tva - t.tva_rembourse)
      ) order by t.taux)
      from taux t
    ), '[]'::jsonb)
  )
  from (
    select
      count(*) as commandes,
      coalesce(sum(total_centimes), 0)::bigint as ttc,
      coalesce(sum(tva_centimes), 0)::bigint as tva,
      coalesce(sum(total_centimes) filter (where statut_paiement in ('paye', 'encaisse', 'rembourse')), 0)::bigint as encaisse,
      count(*) filter (where statut_paiement = 'a_encaisser_retrait') as a_encaisser,
      coalesce(sum(total_centimes) filter (where statut_paiement = 'a_encaisser_retrait'), 0)::bigint as a_encaisser_ttc,
      coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0)::bigint as frais,
      count(*) filter (where mode = 'livraison') as livraisons,
      coalesce(sum(total_centimes) filter (where mode = 'livraison'), 0)::bigint as livraison_ttc,
      count(*) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      coalesce(sum(total_centimes) filter (where moyen_paiement = 'en_ligne'), 0)::bigint as en_ligne_ttc
    from prises
  ) p;
$$;

-- Tableau des ventes : la période, la période de comparaison et chaque jour de la période (jours sans
-- commande compris, pour les graphiques). Sans bornes de comparaison : les mêmes jours de la semaine
-- précédente pour moins de 7 jours (un vendredi se compare au vendredi d'avant), sinon la même durée
-- juste avant. Un an au plus de chaque côté.
create function pilotage_ventes(p_debut date, p_fin date, p_comp_debut date default null, p_comp_fin date default null) returns jsonb
language plpgsql stable as $$
declare
  n integer := p_fin - p_debut + 1;
  decalage integer := case when p_fin - p_debut + 1 < 7 then 7 else p_fin - p_debut + 1 end;
  cd date := coalesce(p_comp_debut, p_debut - decalage);
  cf date := coalesce(p_comp_fin, p_fin - decalage);
begin
  if p_debut is null or p_fin is null or n < 1 or n > 366 or (p_comp_debut is null) <> (p_comp_fin is null) or cf < cd or cf - cd + 1 > 366 then
    raise exception 'Période invalide (un an au plus)';
  end if;
  return jsonb_build_object(
    'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin) || pilotage_synthese(p_debut, p_fin),
    'comparaison', jsonb_build_object('debut', cd, 'fin', cf) || pilotage_synthese(cd, cf),
    'jours', (
      select jsonb_agg(jsonb_build_object(
        'jour', d.jour, 'commandes', coalesce(x.commandes, 0), 'ttc_centimes', coalesce(x.ttc, 0), 'refusees', coalesce(x.refusees, 0)
      ) order by d.jour)
      from (select g::date as jour from generate_series(p_debut::timestamp, p_fin::timestamp, interval '1 day') g) d
      left join (
        select o.jour_service,
          count(*) filter (where o.statut <> 'refusee') as commandes,
          coalesce(sum(o.total_centimes) filter (where o.statut <> 'refusee'), 0)::bigint as ttc,
          count(*) filter (where o.statut = 'refusee') as refusees
        from commandes o
        where o.jour_service between p_debut and p_fin and o.statut not in ('paiement_en_attente', 'annulee')
        group by o.jour_service
      ) x on x.jour_service = d.jour
    )
  );
end;
$$;

revoke execute on function pilotage_synthese(date, date), pilotage_ventes(date, date, date, date) from public, anon, authenticated;
grant execute on function pilotage_synthese(date, date), pilotage_ventes(date, date, date, date) to service_role;
