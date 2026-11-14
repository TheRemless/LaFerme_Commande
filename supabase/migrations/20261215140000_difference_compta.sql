-- Vague 3, bo-commandes : compléments des commandes modifiées dans les chiffres (relecture de bo-pilotage du 14.11.2026).
-- La clôture et l'export Crésus les comptent depuis 20261215130000_difference.sql ; les autres exports et la synthèse
-- doivent tomber juste avec eux (règle de docs/pilotage.md) : même règle partout, jour de la commande (jour de service
-- pour la synthèse), complément encaissé (ou à encaisser dans les ventes de la synthèse, comme une commande), commande
-- ni refusée ni annulée. Jamais dans le compte des commandes.
--
-- Objets recréés, chacun depuis sa dernière définition dans main :
--   export_recap_jours (20261129120000_export_compta.sql) ;
--   export_ventes (20261114090000_correctifs_gerant.sql) : une ligne « (complément) » sous la commande ;
--   pilotage_synthese (20261210170000_annulation_client_chiffres.sql).
-- Numéro réservé par le chef (plage de bo-commandes). Mêmes signatures, droits gardés (create or replace).

create or replace function export_recap_jours(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, o.taux_tva_pourcent as taux, o.moyen_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, false as complement
    from commandes o
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
    union all
    -- Compléments encaissés des commandes modifiées (vague 3, bo-commandes) : au jour de la commande, lien en ligne,
    -- porte ou comptoir au comptoir. Pas une vente de plus dans le compte des commandes.
    select o.jour, o.taux_tva_pourcent, case when k.moyen = 'en_ligne' then 'en_ligne' else 'comptoir' end, k.montant_centimes,
      k.tva_centimes, k.frais_centimes, true
    from complements k join commandes o on o.id = k.commande_id
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
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
      count(*) filter (where not complement) as ventes, sum(total_centimes) filter (where moyen_paiement = 'en_ligne') as en_ligne,
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

create or replace function export_ventes(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(v.j order by v.jour, v.numero, v.ordre), '[]'::jsonb) from (
  select o.jour, o.numero, 0 as ordre, jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(o.cree_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when o.statut_paiement = 'paye' or (o.statut_paiement = 'rembourse' and o.moyen_paiement = 'en_ligne') then 'en ligne' else 'comptoir' end,
    'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
    'taux_tva_pourcent', o.taux_tva_pourcent, 'tva_centimes', o.tva_centimes, 'stripe_payment_intent', o.stripe_payment_intent
  ) as j
  from commandes o
  where o.jour between p_debut and p_fin
    and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
    and o.statut not in ('refusee', 'annulee')
  union all
  -- Compléments encaissés des commandes modifiées (vague 3, bo-commandes) : une ligne de plus, sous la commande.
  select o.jour, o.numero, 1, jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(k.encaisse_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when k.moyen = 'en_ligne' then 'en ligne (complément)' else 'comptoir (complément)' end,
    'sous_total_centimes', k.montant_centimes - k.frais_centimes, 'frais_centimes', k.frais_centimes, 'total_centimes', k.montant_centimes,
    'taux_tva_pourcent', o.taux_tva_pourcent, 'tva_centimes', k.tva_centimes, 'stripe_payment_intent', k.stripe_payment_intent)
  from complements k join commandes o on o.id = k.commande_id
  where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ) v;
$$;

create or replace function pilotage_synthese(p_debut date, p_fin date, p_service text default null) returns jsonb
language sql stable as $$
  with prises as (
    select o.mode, o.moyen_paiement, o.statut_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, o.taux_tva_pourcent
    from commandes o
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  -- Compléments des commandes modifiées (vague 3, bo-commandes), au jour de service de la commande : dans les ventes
  -- (encaissés ou à encaisser, comme les commandes), pas dans le compte des commandes.
  compl as (
    select k.montant_centimes, k.tva_centimes, k.frais_centimes, k.statut, k.moyen, o.mode, o.taux_tva_pourcent
    from complements k join commandes o on o.id = k.commande_id
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  -- Refus du restaurant seulement : une annulation par le client (annulee_par_client_le) n'est pas un refus.
  refusees as (
    select o.total_centimes, coalesce(nullif(btrim(o.motif), ''), 'Sans motif') as motif
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut = 'refusee' and o.annulee_par_client_le is null
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  annulees_client as (
    select o.total_centimes
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut = 'refusee' and o.annulee_par_client_le is not null
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  faits as (
    select r.montant_centimes, r.moyen, o.taux_tva_pourcent
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= ((p_debut + time '05:00') at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1 + time '05:00') at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
      and (p_service is null or pilotage_service_heure(r.fait_le) = p_service)
  ),
  ouverts as (
    select r.statut, r.montant_centimes
    from remboursements r
    where r.statut in ('en_cours', 'echec')
      and r.cree_le >= ((p_debut + time '05:00') at time zone 'Europe/Zurich')
      and r.cree_le < ((p_fin + 1 + time '05:00') at time zone 'Europe/Zurich')
      and (p_service is null or pilotage_service_heure(r.cree_le) = p_service)
  ),
  taux as (
    select t.taux, sum(t.ttc)::bigint as ttc, sum(t.tva)::bigint as tva, sum(t.rembourse)::bigint as rembourse, sum(t.tva_rembourse)::bigint as tva_rembourse
    from (
      select taux_tva_pourcent as taux, total_centimes as ttc, tva_centimes as tva, 0 as rembourse, 0 as tva_rembourse from prises
      union all
      select taux_tva_pourcent, montant_centimes, tva_centimes, 0, 0 from compl
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
    'annulees_client', jsonb_build_object(
      'commandes', (select count(*) from annulees_client),
      'ttc_centimes', (select coalesce(sum(total_centimes), 0) from annulees_client)
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
      coalesce(sum(total_centimes), 0)::bigint + (select coalesce(sum(montant_centimes), 0) from compl)::bigint as ttc,
      coalesce(sum(tva_centimes), 0)::bigint + (select coalesce(sum(tva_centimes), 0) from compl)::bigint as tva,
      coalesce(sum(total_centimes) filter (where statut_paiement in ('paye', 'encaisse', 'rembourse')), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'encaisse'), 0) from compl)::bigint as encaisse,
      count(*) filter (where statut_paiement = 'a_encaisser_retrait') as a_encaisser,
      coalesce(sum(total_centimes) filter (where statut_paiement = 'a_encaisser_retrait'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'a_encaisser'), 0) from compl)::bigint as a_encaisser_ttc,
      coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as frais,
      count(*) filter (where mode = 'livraison') as livraisons,
      coalesce(sum(total_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as livraison_ttc,
      count(*) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      coalesce(sum(total_centimes) filter (where moyen_paiement = 'en_ligne'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where moyen = 'en_ligne'), 0) from compl)::bigint as en_ligne_ttc
    from prises
  ) p;
$$;
