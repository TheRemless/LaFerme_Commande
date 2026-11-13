-- Vague 3, pilotage : temps réels contre temps promis (demande de produit-gestion, « pourquoi vendredi à 20h tout
-- est parti en retard : four, cuisine ou livreurs ? »). Lecture seule, service_role seul, aucune donnée personnelle.
-- Sources : commandes (accepte_le, heure_confirmee, termine_le), commande_postes de tablette (20261203120000 :
-- a_faire_le aux premiers tickets, pret_le la dernière fois qu'un poste a touché « Prête » ou déduit du statut),
-- evenements_commande (départ du livreur, vers = 'partie'). Fonction neuve, aucun objet partagé recréé.
--
-- Définitions (docs/pilotage.md, « Temps ») :
-- - Acceptation : de la commande payée (ou passée, au comptoir) à « Acceptée ».
-- - Préparation d'un poste : des premiers tickets à « Prête » sur ce poste. pret_par = 'statut' : heure déduite
--   (la commande est passée prête, partie ou terminée sans que le poste touche « Prête »), comptée à part.
-- - Retrait : prête quand le dernier poste est prêt ; comparée à l'heure confirmée.
-- - Livraison : livrée quand la commande passe « terminée » ; comparée à l'heure confirmée. Route : du départ du
--   livreur à la livraison.
-- - Une commande est « en retard » si l'heure réelle dépasse l'heure confirmée ; « plus de 10 min » à part.
-- - Heure : heure confirmée à Genève (la tranche où la cuisine était attendue).

create function pilotage_temps(p_debut date, p_fin date, p_service text default null) returns jsonb
language plpgsql stable as $$
begin
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut + 1 > 366 then
    raise exception 'Période invalide (un an au plus)';
  end if;
  if p_service is not null and p_service not in ('midi', 'soir') then
    raise exception 'Service invalide (midi ou soir)';
  end if;
  return (
    with cmd as (
      select o.id, o.mode, o.heure_confirmee, o.accepte_le, o.termine_le, o.statut,
        coalesce(o.paye_le, o.cree_le) as passee_le
      from commandes o
      where o.jour_service between p_debut and p_fin
        and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
        and (p_service is null or pilotage_service_de(o) = p_service)
    ),
    postes as (
      select p.commande_id, p.station::text as station, p.pret_par,
        extract(epoch from (p.pret_le - p.a_faire_le)) / 60 as minutes, p.pret_le
      from commande_postes p join cmd c on c.id = p.commande_id
      where p.pret_le is not null and p.pret_le >= p.a_faire_le
    ),
    prete as (
      select commande_id, max(pret_le) as prete_le from postes group by commande_id
    ),
    depart as (
      select e.commande_id, min(e.le) as part_le
      from evenements_commande e join cmd c on c.id = e.commande_id
      where e.vers = 'partie'
      group by e.commande_id
    ),
    reel as (
      select c.id, c.mode, c.heure_confirmee,
        case when c.mode = 'livraison' then (case when c.statut = 'terminee' then c.termine_le end) else pr.prete_le end as reel_le,
        extract(epoch from (c.termine_le - d.part_le)) / 60 as route_min
      from cmd c
      left join prete pr on pr.commande_id = c.id
      left join depart d on d.commande_id = c.id
      where c.heure_confirmee is not null
    ),
    ecarts as (
      select id, mode, heure_confirmee, route_min, extract(epoch from (reel_le - heure_confirmee)) / 60 as retard_min
      from reel where reel_le is not null
    )
    select jsonb_build_object(
      'debut', p_debut, 'fin', p_fin, 'service', p_service,
      'acceptation', (
        select jsonb_build_object(
          'commandes', count(*),
          'mediane_min', round((percentile_cont(0.5) within group (order by m))::numeric, 1),
          'p90_min', round((percentile_cont(0.9) within group (order by m))::numeric, 1)
        )
        from (select extract(epoch from (accepte_le - passee_le)) / 60 as m from cmd where accepte_le is not null and accepte_le >= passee_le) a
      ),
      'postes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'station', station, 'commandes', n, 'mediane_min', mediane, 'p90_min', p90, 'deduites', deduites
        ) order by station)
        from (
          select station, count(*) as n,
            round((percentile_cont(0.5) within group (order by minutes))::numeric, 1) as mediane,
            round((percentile_cont(0.9) within group (order by minutes))::numeric, 1) as p90,
            count(*) filter (where pret_par = 'statut') as deduites
          from postes group by station
        ) s
      ), '[]'::jsonb),
      'ponctualite', (
        select coalesce(jsonb_object_agg(mode, x), '{}'::jsonb) from (
          select mode, jsonb_build_object(
            'commandes', count(*),
            'a_l_heure', count(*) filter (where retard_min <= 0),
            'en_retard', count(*) filter (where retard_min > 0),
            'plus_de_10', count(*) filter (where retard_min > 10),
            'retard_median_min', round(coalesce((percentile_cont(0.5) within group (order by retard_min) filter (where retard_min > 0)), 0)::numeric, 1),
            'route_mediane_min', round((percentile_cont(0.5) within group (order by route_min) filter (where route_min is not null))::numeric, 1)
          ) as x
          from ecarts group by mode
        ) m
      ),
      'heures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'heure', h.heure, 'commandes', h.n, 'en_retard', h.retard,
          'pizza_mediane_min', (select round((percentile_cont(0.5) within group (order by p.minutes))::numeric, 1) from postes p join cmd c on c.id = p.commande_id
            where p.station = 'pizza' and extract(hour from c.heure_confirmee at time zone 'Europe/Zurich') = h.heure),
          'cuisine_mediane_min', (select round((percentile_cont(0.5) within group (order by p.minutes))::numeric, 1) from postes p join cmd c on c.id = p.commande_id
            where p.station = 'cuisine' and extract(hour from c.heure_confirmee at time zone 'Europe/Zurich') = h.heure),
          'route_mediane_min', h.route
        ) order by h.heure)
        from (
          select extract(hour from heure_confirmee at time zone 'Europe/Zurich')::int as heure, count(*) as n,
            count(*) filter (where retard_min > 0) as retard,
            round((percentile_cont(0.5) within group (order by route_min) filter (where route_min is not null))::numeric, 1) as route
          from ecarts group by 1
        ) h
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function pilotage_temps(date, date, text) from public, anon, authenticated;
grant execute on function pilotage_temps(date, date, text) to service_role;
