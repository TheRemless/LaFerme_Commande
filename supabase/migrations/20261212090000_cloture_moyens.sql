-- Vague 3, pilotage : clôture du jour avec les espèces et la carte au comptoir séparées, maintenant que la
-- tablette note le moyen à l'encaissement (commandes.moyen_comptoir, PR #115).
-- Objets recréés (create or replace, même signature, depuis sa dernière définition : 20261210190000_cloture_jour.sql) :
-- cloture_rapport(date) et cloture_jour(date). Champs ajoutés dans « encaissements » : comptoir_especes, comptoir_carte, comptoir_non_note,
-- attendu_especes_centimes, attendu_carte_centimes. Rien de retiré : attendu_comptoir_centimes (espèces et carte
-- ensemble) reste la base de l'écart enregistré par cloturer_jour. Droits inchangés (create or replace les garde).

create or replace function cloture_rapport(p_jour date) returns jsonb
language sql stable as $$
  with bornes as (
    select (p_jour + time '05:00') at time zone 'Europe/Zurich' as debut,
           (p_jour + 1 + time '05:00') at time zone 'Europe/Zurich' as fin
  ),
  jour as (
    select o.* from commandes o
    where o.jour_service = p_jour and o.statut not in ('paiement_en_attente', 'annulee')
  ),
  -- Ce que le client a eu en moins sur une commande pas encore payée au comptoir (manque déduit).
  deductions as (
    select r.commande_id, sum(r.montant_centimes)::bigint as montant
    from remboursements r join jour o on o.id = r.commande_id
    where r.moyen = 'deduction' and r.statut = 'fait'
    group by r.commande_id
  ),
  comptoir as (
    select o.id, o.moyen_comptoir, o.total_centimes - coalesce(d.montant, 0) as encaisse
    from jour o left join deductions d on d.commande_id = o.id
    where o.moyen_paiement = 'comptoir' and o.statut <> 'refusee' and o.statut_paiement in ('encaisse', 'rembourse')
  ),
  rembs as (
    select r.*, o.numero, o.statut as statut_commande, o.moyen_paiement
    from remboursements r join commandes o on o.id = r.commande_id, bornes b
    where (r.statut = 'fait' and r.fait_le >= b.debut and r.fait_le < b.fin)
       or (r.statut <> 'fait' and r.cree_le >= b.debut and r.cree_le < b.fin)
  ),
  especes_rendues as (
    select coalesce(sum(montant_centimes), 0)::bigint as montant from rembs where moyen = 'especes' and statut = 'fait'
  )
  select jsonb_build_object(
    'jour', p_jour,
    'debut', (select debut from bornes),
    'fin', (select fin from bornes),
    'calcule_le', now(),
    'ventes', pilotage_synthese(p_jour, p_jour),
    'encaissements', jsonb_build_object(
      'en_ligne', (
        select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(total_centimes), 0))
        from jour where moyen_paiement = 'en_ligne' and statut <> 'refusee' and statut_paiement in ('paye', 'rembourse')
      ),
      'comptoir', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir),
      'deductions_centimes', (select coalesce(sum(montant), 0) from deductions),
      'especes_rendues_centimes', (select montant from especes_rendues),
      'attendu_comptoir_centimes', (select coalesce(sum(encaisse), 0) from comptoir) - (select montant from especes_rendues),
      -- Moyen noté par la tablette à l'encaissement (20261203090000_tablette_encaissement.sql) : les espèces
      -- se comparent au tiroir, la carte au ticket du terminal. Non noté : encaissé avant ce changement, ou
      -- par un chemin qui ne le demande pas ; il empêche d'attribuer un écart à l'un ou à l'autre.
      'comptoir_especes', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir = 'especes'),
      'comptoir_carte', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir = 'carte'),
      'comptoir_non_note', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir is null),
      'attendu_especes_centimes', (select coalesce(sum(encaisse), 0) from comptoir where moyen_comptoir = 'especes') - (select montant from especes_rendues),
      'attendu_carte_centimes', (select coalesce(sum(encaisse), 0) from comptoir where moyen_comptoir = 'carte')
    ),
    'a_encaisser', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', o.numero, 'mode', o.mode, 'statut', o.statut,
        'du_centimes', o.total_centimes - coalesce(d.montant, 0),
        'heure', to_char(coalesce(o.heure_confirmee, o.cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by o.numero)
      from jour o left join deductions d on d.commande_id = o.id
      where o.statut_paiement = 'a_encaisser_retrait' and o.statut <> 'refusee'
    ), '[]'::jsonb),
    'remboursements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', numero, 'montant_centimes', montant_centimes, 'moyen', moyen, 'statut', statut, 'motif', motif,
        'par', personnel_nom, 'commande_refusee', statut_commande = 'refusee', 'erreur', erreur,
        'heure', to_char(coalesce(fait_le, cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by coalesce(fait_le, cree_le))
      from rembs
    ), '[]'::jsonb),
    'ecarts', coalesce((
      select jsonb_agg(e.j order by e.ordre, e.numero) from (
        select 1 as ordre, o.numero, jsonb_build_object('type', 'remise_sans_encaissement', 'numero', o.numero,
          'centimes', o.total_centimes - coalesce(d.montant, 0)) as j
        from jour o left join deductions d on d.commande_id = o.id
        where o.statut = 'terminee' and o.statut_paiement = 'a_encaisser_retrait'
        union all
        select 2, numero, jsonb_build_object('type', 'remboursement_' || statut, 'numero', numero, 'centimes', montant_centimes)
        from rembs where statut in ('echec', 'en_cours')
        union all
        select 3, o.numero, jsonb_build_object('type', 'pas_terminee', 'numero', o.numero, 'statut', o.statut, 'centimes', o.total_centimes)
        from jour o where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
      ) e
    ), '[]'::jsonb)
  );
$$;

create or replace function cloture_jour(p_jour date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'rapport', coalesce(c.rapport, x.actuel),
    'cloture', to_jsonb(c) - 'personnel_id' - 'rapport',
    -- On compare seulement ce que le rapport enregistré contient : un champ ajouté plus tard (comptoir_especes…)
    -- ne fait pas croire qu'un jour clôturé a changé.
    'change_depuis', c.jour is not null and (c.rapport - 'calcule_le') is distinct from (
      (x.actuel - 'calcule_le') || jsonb_build_object('encaissements', (
        select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) from jsonb_each(x.actuel -> 'encaissements') e(k, v)
        where c.rapport -> 'encaissements' ? e.k
      ))
    )
  )
  from (select cloture_rapport(p_jour) as actuel) x
  left join clotures c on c.jour = p_jour;
$$;
