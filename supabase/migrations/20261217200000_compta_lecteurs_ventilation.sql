-- Vague 3, bo-pilotage : comptes justes au droit suisse, R20 du plan docs/compta/plan-conformite.md. Les lecteurs
-- de la compta passent par la ventilation par taux, et plus jamais par commandes.taux_tva_pourcent, qui ne dit que
-- le taux le plus haut d'une commande mixte (20261217150000, bo-carte).
--
-- Sources, accord du 19.11.2026 entre bo-pilotage, bo-carte et bo-commandes :
--   ventilation_commande(o) : la vente, figée au paiement (20261217190000) ;
--   ventilation_complement(k) : un complément, parts signées ;
--   ventilation_remboursement(r) : un avoir, parts signées (une part négative est une vente) ;
--   modifications_commande.ventilation : un échange sans argent (statut 'appliquee', différence 0), à fini_le.
--
-- Objets recréés, chacun depuis sa dernière définition, mêmes signatures, droits gardés :
--   pilotage_synthese (20261217170000) : TVA par taux sur les ventilations, rabais et cagnotte utilisée ;
--   export_recap_jours (20261216140000), export_cresus (20261216140000), export_ventes (20261215140000),
--   export_remboursements (20261117090000), export_cresus_etendu (20261217130000).
-- Nouveau : regler_regle_tva (réglages frais_tva_mixte et rabais_tva_mixte de bo-carte, à l'écran du gérant).
-- Le réglage compta_multi_taux_pret reste faux : bo-carte le passe à vrai dans la PR qui rend la teneur en alcool
-- obligatoire pour vendre une boisson (accord du 19.11.2026), une fois ces lecteurs fusionnés.

create or replace function pilotage_synthese(p_debut date, p_fin date, p_service text default null) returns jsonb
language sql stable as $$
  with prises as (
    select o.mode, o.moyen_paiement, o.statut_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, o.taux_tva_pourcent,
      o.remise_centimes, o.cagnotte_centimes, ventilation_commande(o) as v
    from commandes o
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  -- Compléments des commandes modifiées (vague 3, bo-commandes), au jour de service de la commande : dans les ventes
  -- (encaissés ou à encaisser, comme les commandes), pas dans le compte des commandes.
  compl as (
    select k.montant_centimes, k.tva_centimes, k.frais_centimes, k.statut, k.moyen, o.mode, o.taux_tva_pourcent, ventilation_complement(k) as v
    from complements k join commandes o on o.id = k.commande_id
    where o.jour_service between p_debut and p_fin and k.statut in ('a_encaisser', 'encaisse')
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
    select r.montant_centimes, r.moyen, o.taux_tva_pourcent, ventilation_remboursement(r) as v
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
  -- Échange sans argent (modification appliquée à différence 0, bo-commandes) : parts signées, somme nulle, au jour
  -- de service où il est fait. Ne change que la TVA par taux.
  corrections as (
    select m.ventilation as v
    from modifications_commande m join commandes o on o.id = m.commande_id
    where m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
      and m.fini_le >= ((p_debut + time '05:00') at time zone 'Europe/Zurich')
      and m.fini_le < ((p_fin + 1 + time '05:00') at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
      and (p_service is null or pilotage_service_heure(m.fini_le) = p_service)
  ),
  -- TVA par taux : ventilations figées des commandes, des compléments, des remboursements et des échanges
  -- (20261217130000, 20261217150000, 20261217190000), jamais taux_tva_pourcent.
  taux as (
    select t.taux, sum(t.ttc)::bigint as ttc, sum(t.tva)::bigint as tva, sum(t.rembourse)::bigint as rembourse, sum(t.tva_rembourse)::bigint as tva_rembourse
    from (
      select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::bigint as ttc, (x ->> 'tva')::bigint as tva, 0::bigint as rembourse, 0::bigint as tva_rembourse
      from prises, jsonb_array_elements(prises.v) x
      union all
      select (x ->> 'taux')::numeric, (x ->> 'ttc')::bigint, (x ->> 'tva')::bigint, 0, 0 from compl, jsonb_array_elements(compl.v) x
      union all
      select (x ->> 'taux')::numeric, (x ->> 'ttc')::bigint, (x ->> 'tva')::bigint, 0, 0 from corrections, jsonb_array_elements(corrections.v) x
      union all
      select (x ->> 'taux')::numeric, 0, 0, (x ->> 'ttc')::bigint, (x ->> 'tva')::bigint from faits, jsonb_array_elements(faits.v) x
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
    -- Rabais des codes promo et cagnotte utilisée, déjà déduits du TTC (R14, R20).
    'rabais_centimes', p.rabais,
    'cagnotte_centimes', p.cagnotte,
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
        'faits_terminal_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'terminal'), 0) from faits),
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
      -- Somme de la TVA par taux : un échange sans argent déplace la TVA sans changer le TTC.
      (select coalesce(sum(tva), 0) from taux)::bigint as tva,
      coalesce(sum(total_centimes) filter (where statut_paiement in ('paye', 'encaisse', 'rembourse')), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'encaisse'), 0) from compl)::bigint as encaisse,
      count(*) filter (where statut_paiement = 'a_encaisser_retrait') as a_encaisser,
      coalesce(sum(total_centimes) filter (where statut_paiement = 'a_encaisser_retrait'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'a_encaisser'), 0) from compl)::bigint as a_encaisser_ttc,
      coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as frais,
      coalesce(sum(remise_centimes), 0)::bigint as rabais,
      coalesce(sum(cagnotte_centimes), 0)::bigint as cagnotte,
      count(*) filter (where mode = 'livraison') as livraisons,
      coalesce(sum(total_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as livraison_ttc,
      count(*) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      coalesce(sum(total_centimes) filter (where moyen_paiement = 'en_ligne'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where moyen = 'en_ligne'), 0) from compl)::bigint as en_ligne_ttc
    from prises
  ) p;
$$;

-- Récapitulatif par jour et par taux : mêmes règles qu'avant (vente au jour de la commande, remboursement au jour
-- où il est fait), montants par taux pris des ventilations. Les frais d'un complément vont à sa plus grande part
-- positive (là où ils ont été payés). Un échange sans argent compte au jour où il est fait, sans moyen.
create or replace function export_recap_jours(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, (x ->> 'taux')::numeric as taux, o.moyen_paiement, (x ->> 'ttc')::integer as total_centimes,
      (x ->> 'tva')::integer as tva_centimes, coalesce((x ->> 'frais_ttc')::integer, 0) as frais_centimes,
      x.rang = 1 as compte
    from commandes o, jsonb_array_elements(ventilation_commande(o)) with ordinality x(x, rang)
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
    union all
    -- Compléments encaissés des commandes modifiées (bo-commandes) : au jour de la commande, lien en ligne, porte ou
    -- comptoir au comptoir. Pas une vente de plus dans le compte des commandes.
    select o.jour, (x ->> 'taux')::numeric, case when k.moyen = 'en_ligne' then 'en_ligne' else 'comptoir' end,
      (x ->> 'ttc')::integer, (x ->> 'tva')::integer,
      case when row_number() over (partition by k.id order by (x ->> 'ttc')::integer desc, (x ->> 'taux')::numeric desc) = 1 then k.frais_centimes else 0 end,
      false
    from complements k join commandes o on o.id = k.commande_id, jsonb_array_elements(ventilation_complement(k)) x
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
    union all
    select (m.fini_le at time zone 'Europe/Zurich')::date, (x ->> 'taux')::numeric, null, (x ->> 'ttc')::integer, (x ->> 'tva')::integer, 0, false
    from modifications_commande m join commandes o on o.id = m.commande_id, jsonb_array_elements(m.ventilation) x
    where m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
      and m.fini_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and m.fini_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, (x ->> 'taux')::numeric as taux, r.moyen,
      (x ->> 'ttc')::integer as montant_centimes, (x ->> 'tva')::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id, jsonb_array_elements(ventilation_remboursement(r)) x
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux,
      count(*) filter (where compte) as ventes, sum(total_centimes) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      sum(total_centimes) filter (where moyen_paiement = 'comptoir') as comptoir, sum(frais_centimes) as frais,
      sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      0 as remb_stripe, 0 as remb_especes, 0 as remb_deduction, 0 as tva_remb, 0 as remb_terminal
    from ventes group by jour, taux
    union all
    select jour, taux, 0, 0, 0, 0, 0, 0,
      sum(montant_centimes) filter (where moyen = 'stripe'), sum(montant_centimes) filter (where moyen = 'especes'),
      sum(montant_centimes) filter (where moyen = 'deduction'), sum(tva), sum(montant_centimes) filter (where moyen = 'terminal')
    from rembs group by jour, taux
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', x.jour, 'taux_tva_pourcent', x.taux, 'ventes', x.ventes,
    'en_ligne_centimes', x.en_ligne, 'comptoir_centimes', x.comptoir, 'frais_centimes', x.frais, 'ttc_centimes', x.ttc,
    'tva_centimes', x.tva,
    'rembourse_en_ligne_centimes', x.remb_stripe, 'rembourse_especes_centimes', x.remb_especes,
    'deduit_centimes', x.remb_deduction, 'tva_remboursee_centimes', x.tva_remb, 'rembourse_terminal_centimes', x.remb_terminal,
    'net_ttc_centimes', x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction - x.remb_terminal,
    'net_tva_centimes', x.tva - x.tva_remb,
    'net_ht_centimes', (x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction - x.remb_terminal) - (x.tva - x.tva_remb)
  ) order by x.jour, x.taux), '[]'::jsonb)
  from (
    select jour, taux,
      sum(ventes)::bigint as ventes, coalesce(sum(en_ligne), 0)::bigint as en_ligne, coalesce(sum(comptoir), 0)::bigint as comptoir,
      coalesce(sum(frais), 0)::bigint as frais, coalesce(sum(ttc), 0)::bigint as ttc, coalesce(sum(tva), 0)::bigint as tva,
      coalesce(sum(remb_stripe), 0)::bigint as remb_stripe, coalesce(sum(remb_especes), 0)::bigint as remb_especes,
      coalesce(sum(remb_deduction), 0)::bigint as remb_deduction, coalesce(sum(tva_remb), 0)::bigint as tva_remb,
      coalesce(sum(remb_terminal), 0)::bigint as remb_terminal
    from lignes group by jour, taux
  ) x;
$$;

-- Une ligne par commande et par taux (une seule pour une commande à un taux) : « premiere » marque la ligne qui
-- compte la commande. Puis les compléments par taux, puis les échanges sans argent (au jour où ils sont faits).
create or replace function export_ventes(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(v.j order by v.jour, v.numero, v.ordre, v.taux), '[]'::jsonb) from (
  select o.jour, o.numero, 0 as ordre, (x ->> 'taux')::numeric as taux, jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(o.cree_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when o.statut_paiement = 'paye' or (o.statut_paiement = 'rembourse' and o.moyen_paiement = 'en_ligne') then 'en ligne' else 'comptoir' end,
    'sous_total_centimes', (x ->> 'ttc')::integer - coalesce((x ->> 'frais_ttc')::integer, 0),
    'frais_centimes', coalesce((x ->> 'frais_ttc')::integer, 0), 'total_centimes', (x ->> 'ttc')::integer,
    'taux_tva_pourcent', (x ->> 'taux')::numeric, 'tva_centimes', (x ->> 'tva')::integer, 'stripe_payment_intent', o.stripe_payment_intent,
    'premiere', x.rang = 1
  ) as j
  from commandes o, jsonb_array_elements(ventilation_commande(o)) with ordinality x(x, rang)
  where o.jour between p_debut and p_fin
    and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
    and o.statut not in ('refusee', 'annulee')
  union all
  select o.jour, o.numero, 1, (x ->> 'taux')::numeric, jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(k.encaisse_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when k.moyen = 'en_ligne' then 'en ligne (complément)' else 'comptoir (complément)' end,
    'sous_total_centimes', (x ->> 'ttc')::integer - f.frais, 'frais_centimes', f.frais, 'total_centimes', (x ->> 'ttc')::integer,
    'taux_tva_pourcent', (x ->> 'taux')::numeric, 'tva_centimes', (x ->> 'tva')::integer, 'stripe_payment_intent', k.stripe_payment_intent,
    'premiere', false)
  from complements k join commandes o on o.id = k.commande_id,
    lateral (select x, case when row_number() over (order by (x ->> 'ttc')::integer desc, (x ->> 'taux')::numeric desc) = 1 then k.frais_centimes else 0 end as frais
             from jsonb_array_elements(ventilation_complement(k)) x) f
  where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  union all
  select (m.fini_le at time zone 'Europe/Zurich')::date, o.numero, 2, (x ->> 'taux')::numeric, jsonb_build_object(
    'jour', (m.fini_le at time zone 'Europe/Zurich')::date, 'numero', o.numero, 'heure', to_char(m.fini_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', 'échange sans argent',
    'sous_total_centimes', (x ->> 'ttc')::integer, 'frais_centimes', 0, 'total_centimes', (x ->> 'ttc')::integer,
    'taux_tva_pourcent', (x ->> 'taux')::numeric, 'tva_centimes', (x ->> 'tva')::integer, 'stripe_payment_intent', null,
    'premiere', false)
  from modifications_commande m join commandes o on o.id = m.commande_id, jsonb_array_elements(m.ventilation) x
  where m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
    and (m.fini_le at time zone 'Europe/Zurich')::date between p_debut and p_fin
    and o.statut not in ('refusee', 'annulee')
  ) v;
$$;

-- Une ligne par remboursement et par taux de sa ventilation (parts signées).
create or replace function export_remboursements(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', (r.fait_le at time zone 'Europe/Zurich')::date, 'heure', to_char(r.fait_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'numero', o.numero, 'jour_vente', o.jour, 'mode', o.mode,
    'paiement', case when r.moyen = 'stripe' then 'en ligne' else 'comptoir' end,
    'montant_centimes', (x ->> 'ttc')::integer, 'taux_tva_pourcent', (x ->> 'taux')::numeric,
    'tva_centimes', (x ->> 'tva')::integer,
    'reference', r.stripe_refund_id
  ) order by r.fait_le, (x ->> 'taux')::numeric), '[]'::jsonb)
  from remboursements r join commandes o on o.id = r.commande_id, jsonb_array_elements(ventilation_remboursement(r)) x
  where r.statut = 'fait' and (r.fait_le at time zone 'Europe/Zurich')::date between p_debut and p_fin
    and o.statut not in ('refusee', 'annulee');
$$;

-- Format simple : mêmes lignes qu'avant, par taux de la ventilation (le format refuse plusieurs taux sur une période,
-- un seul compte de ventes). Les échanges sans argent y entrent : entre deux taux, la période est refusée.
create or replace function export_cresus(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, (x ->> 'taux')::numeric as taux,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      (x ->> 'ttc')::integer as total_centimes, (x ->> 'tva')::integer as tva_centimes,
      coalesce((x ->> 'frais_ttc')::integer, 0) as frais_centimes, coalesce((x ->> 'frais_tva')::integer, 0) as tva_frais,
      x.rang = 1 as compte
    from commandes o, jsonb_array_elements(ventilation_commande(o)) with ordinality x(x, rang)
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
  ),
  complements_v as (
    select o.jour, (x ->> 'taux')::numeric as taux,
      case when k.moyen = 'en_ligne' then 'stripe' when k.moyen_encaissement = 'carte' then 'terminal' else 'caisse' end as moyen,
      (x ->> 'ttc')::integer as total_centimes, (x ->> 'tva')::integer as tva_centimes,
      case when row_number() over (partition by k.id order by (x ->> 'ttc')::integer desc, (x ->> 'taux')::numeric desc) = 1 then k.frais_centimes else 0 end as frais_centimes,
      0 as tva_frais, false as compte
    from complements k join commandes o on o.id = k.commande_id, jsonb_array_elements(ventilation_complement(k)) x
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  complements_f as (
    select jour, taux, moyen, total_centimes, tva_centimes, frais_centimes,
      round(frais_centimes * taux / (100 + taux))::integer as tva_frais, compte
    from complements_v
  ),
  -- Échange sans argent (à fini_le) : il met deux taux sur la période, et le format simple la refuse avec un message.
  echanges as (
    select (m.fini_le at time zone 'Europe/Zurich')::date as jour, (x ->> 'taux')::numeric as taux,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      (x ->> 'ttc')::integer as total_centimes, (x ->> 'tva')::integer as tva_centimes, 0 as frais_centimes, 0 as tva_frais, false as compte
    from modifications_commande m join commandes o on o.id = m.commande_id, jsonb_array_elements(m.ventilation) x
    where m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
      and m.fini_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and m.fini_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, (x ->> 'taux')::numeric as taux,
      case when r.moyen = 'stripe' then 'stripe' when r.moyen = 'especes' then 'caisse' when r.moyen = 'terminal' then 'terminal'
           when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      (x ->> 'ttc')::integer as montant_centimes, (x ->> 'tva')::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id, jsonb_array_elements(ventilation_remboursement(r)) x
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux, 'vente' as sorte, moyen, count(*) filter (where compte) as nombre, sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      sum(frais_centimes) as frais, sum(tva_frais) as tva_frais
    from (select * from ventes union all select * from complements_f union all select * from echanges) v group by jour, taux, moyen
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

-- Format étendu : ventes figées par taux (rabais et cagnotte compris), compléments par taux (parts signées, frais à
-- la part du taux le plus haut), avoirs par taux (parts signées), échanges sans argent à fini_le.
create or replace function export_cresus_etendu(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with v as (
    select o.jour,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      x, x.rang = 1 as compte
    from commandes o, jsonb_array_elements(ventilation_commande(o)) with ordinality x(x, rang)
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
    union all
    select o.jour,
      case when k.moyen = 'en_ligne' then 'stripe' when k.moyen_encaissement = 'carte' then 'terminal' else 'caisse' end,
      jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', (x ->> 'ttc')::integer, 'tva', (x ->> 'tva')::integer,
        'frais_ttc', f.frais, 'frais_tva', round(f.frais * (x ->> 'taux')::numeric / (100 + (x ->> 'taux')::numeric))::integer,
        'rabais_ttc', 0, 'rabais_tva', 0, 'cagnotte_ttc', 0, 'cagnotte_tva', 0),
      false
    from complements k join commandes o on o.id = k.commande_id,
      lateral (select x, case when row_number() over (order by (x ->> 'ttc')::integer desc, (x ->> 'taux')::numeric desc) = 1 then k.frais_centimes else 0 end as frais
               from jsonb_array_elements(ventilation_complement(k)) x) f
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  ventes as (
    select jour, moyen, (x ->> 'taux')::numeric as taux, count(*) filter (where compte) as nombre,
      sum((x ->> 'ttc')::bigint) as ttc, sum((x ->> 'tva')::bigint) as tva,
      sum(coalesce((x ->> 'frais_ttc')::bigint, 0)) as frais_ttc, sum(coalesce((x ->> 'frais_tva')::bigint, 0)) as frais_tva,
      sum(coalesce((x ->> 'rabais_ttc')::bigint, 0)) as rabais_ttc, sum(coalesce((x ->> 'rabais_tva')::bigint, 0)) as rabais_tva,
      sum(coalesce((x ->> 'cagnotte_ttc')::bigint, 0)) as cagnotte_ttc, sum(coalesce((x ->> 'cagnotte_tva')::bigint, 0)) as cagnotte_tva
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
  ),
  echanges as (
    select (m.fini_le at time zone 'Europe/Zurich')::date as jour,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      o.numero as commande, m.ventilation
    from modifications_commande m join commandes o on o.id = m.commande_id
    where m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
      and m.fini_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and m.fini_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  )
  select jsonb_build_object(
    'ventes', coalesce((select jsonb_agg(jsonb_build_object(
      'jour', jour, 'moyen', moyen, 'taux', taux, 'nombre', nombre, 'ttc', ttc, 'tva', tva, 'frais_ttc', frais_ttc,
      'frais_tva', frais_tva, 'rabais_ttc', rabais_ttc, 'rabais_tva', rabais_tva, 'cagnotte_ttc', cagnotte_ttc,
      'cagnotte_tva', cagnotte_tva) order by jour, moyen, taux) from ventes), '[]'::jsonb),
    'avoirs', coalesce((select jsonb_agg(jsonb_build_object(
      'numero_avoir', numero_avoir, 'jour', jour, 'moyen', moyen, 'commande', commande,
      'stripe_refund_id', stripe_refund_id, 'ventilation', ventilation) order by jour, numero_avoir) from avoirs), '[]'::jsonb),
    'echanges', coalesce((select jsonb_agg(jsonb_build_object(
      'jour', jour, 'moyen', moyen, 'commande', commande, 'ventilation', ventilation) order by jour, commande) from echanges), '[]'::jsonb)
  );
$$;

-- ---------- Réglages de bo-carte à l'écran (F3, F4) ----------

-- p_cle : frais_tva_mixte ('normal' | 'prorata') ou rabais_tva_mixte ('reduit_dabord' | 'prorata'). Gérant, journalisé.
create function regler_regle_tva(p_cle text, p_valeur text, p_personnel uuid) returns text
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  if not ((p_cle = 'frais_tva_mixte' and p_valeur in ('normal', 'prorata'))
          or (p_cle = 'rabais_tva_mixte' and p_valeur in ('reduit_dabord', 'prorata'))) then
    raise exception 'regle_invalide';
  end if;
  select valeur into avant from reglages where cle = p_cle for update;
  insert into reglages (cle, valeur, proposition) values (p_cle, to_jsonb(p_valeur), false)
    on conflict (cle) do update set valeur = excluded.valeur, proposition = false;
  if avant is distinct from to_jsonb(p_valeur) then
    perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(p_valeur));
  end if;
  return regle_tva(p_cle);
end;
$$;

create function regles_tva() returns jsonb
language sql stable as $$
  select jsonb_build_object('frais_tva_mixte', regle_tva('frais_tva_mixte'), 'rabais_tva_mixte', regle_tva('rabais_tva_mixte'));
$$;

revoke execute on function regler_regle_tva(text, text, uuid), regles_tva() from public, anon, authenticated;
grant execute on function regler_regle_tva(text, text, uuid), regles_tva() to service_role;
