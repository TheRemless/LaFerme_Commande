-- Vague 3, pilotage : analyses d'une période, calculées en base. Lecture seule, service_role seul, mêmes
-- définitions que pilotage_ventes (jour de service, commande prise, p_service midi ou soir). Aucune donnée
-- personnelle : un client se reconnaît à son adresse e-mail (en minuscules) à l'intérieur de la base, seul
-- le nombre de clients en sort.

create function pilotage_analyses(p_debut date, p_fin date, p_service text default null) returns jsonb
language plpgsql stable as $$
begin
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut + 1 > 366 then
    raise exception 'Période invalide (un an au plus)';
  end if;
  if p_service is not null and p_service not in ('midi', 'soir') then
    raise exception 'Service invalide (midi ou soir)';
  end if;
  return (
    with prises as (
      select o.id, o.mode, o.zone_numero, o.total_centimes, o.frais_centimes, o.client_email,
        -- Heure de service, déjà à l'heure de Genève (une seule conversion par commande).
        coalesce(
          o.heure_confirmee at time zone 'Europe/Zurich',
          case when o.quand_type = 'creneau' and o.quand_date is not null and o.quand_minutes is not null
            then o.quand_date + make_interval(mins => o.quand_minutes::integer) end,
          o.cree_le at time zone 'Europe/Zurich'
        ) as heure
      from commandes o
      where o.jour_service between p_debut and p_fin
        and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
        and (p_service is null or pilotage_service_de(o) = p_service)
    ),
    par_plat as (
      select l.plat_slug, max(l.nom) as nom_vendu, sum(l.qte)::bigint as qte, sum(l.total_centimes)::bigint as ttc
      from commande_lignes l join prises p on p.id = l.commande_id
      group by l.plat_slug
    ),
    plats_cat as (
      -- Nom actuel de la carte (un plat renommé garde son slug), sinon le nom vendu (plat supprimé).
      select pp.plat_slug, coalesce(pl.nom, pp.nom_vendu) as nom, pp.qte, pp.ttc,
        coalesce(c.nom, 'Hors carte') as categorie, coalesce(c.ordre, 999) as ordre_cat
      from par_plat pp
      left join plats pl on pl.slug = pp.plat_slug
      left join categories c on c.id = pl.categorie_id
    ),
    -- Index commandes_email_idx (lower(client_email), …) : une recherche par client. « Avant » = jour de service
    -- antérieur à la période (une commande passée à l'avance pour un jour de la période ne compte pas).
    clients as (
      select e.email, count(*) as commandes, sum(e.total)::bigint as ttc,
        not exists (
          select 1 from commandes a
          where lower(a.client_email) = e.email and a.jour_service < p_debut
            and a.statut not in ('paiement_en_attente', 'annulee', 'refusee')
        ) as nouveau
      from (select lower(client_email) as email, total_centimes as total from prises) e
      group by e.email
    ),
    jours_semaine as (
      select extract(isodow from g)::int as jour, count(*) as nombre
      from generate_series(p_debut::timestamp, p_fin::timestamp, interval '1 day') g group by 1
    )
    select jsonb_build_object(
      'debut', p_debut, 'fin', p_fin, 'service', p_service,
      'ventes_plats_centimes', (select coalesce(sum(ttc), 0) from par_plat),
      'plats', coalesce((
        select jsonb_agg(jsonb_build_object('slug', plat_slug, 'nom', nom, 'categorie', categorie, 'qte', qte,
          'ttc_centimes', ttc) order by ttc desc, nom)
        from plats_cat
      ), '[]'::jsonb),
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object('categorie', categorie, 'qte', qte, 'ttc_centimes', ttc, 'plats', n) order by ttc desc, categorie)
        from (select categorie, sum(qte)::bigint as qte, sum(ttc)::bigint as ttc, count(*) as n
              from plats_cat group by categorie) x
      ), '[]'::jsonb),
      -- Carte de chaleur : jour de la semaine (1 = lundi) et heure à Genève de l'heure de service.
      -- jours = combien de fois ce jour de la semaine tombe dans la période, pour une moyenne par jour.
      'heures', coalesce((
        select jsonb_agg(jsonb_build_object('jour', h.jour, 'heure', h.heure, 'commandes', h.n, 'ttc_centimes', h.ttc,
          'jours', coalesce(js.nombre, 0)) order by h.jour, h.heure)
        from (
          select extract(isodow from heure)::int as jour, extract(hour from heure)::int as heure,
            count(*) as n, sum(total_centimes)::bigint as ttc
          from prises group by 1, 2
        ) h left join jours_semaine js on js.jour = h.jour
      ), '[]'::jsonb),
      'jours_semaine', coalesce((select jsonb_object_agg(jour, nombre) from jours_semaine), '{}'::jsonb),
      'zones', coalesce((
        select jsonb_agg(jsonb_build_object('zone', z.zone_numero, 'nom', zl.nom, 'commandes', z.n, 'ttc_centimes', z.ttc,
          'frais_centimes', z.frais, 'panier_moyen_centimes', round(z.ttc::numeric / z.n)::bigint) order by z.zone_numero nulls last)
        from (
          select zone_numero, count(*) as n, sum(total_centimes)::bigint as ttc, sum(frais_centimes)::bigint as frais
          from prises where mode = 'livraison' group by zone_numero
        ) z left join zones_livraison zl on zl.numero = z.zone_numero
      ), '[]'::jsonb),
      'clients', (
        select jsonb_build_object(
          'clients', count(*),
          'nouveaux', count(*) filter (where nouveau),
          'nouveaux_commandes', coalesce(sum(commandes) filter (where nouveau), 0),
          'nouveaux_ttc_centimes', coalesce(sum(ttc) filter (where nouveau), 0),
          'fideles', count(*) filter (where not nouveau),
          'fideles_commandes', coalesce(sum(commandes) filter (where not nouveau), 0),
          'fideles_ttc_centimes', coalesce(sum(ttc) filter (where not nouveau), 0),
          'revenus_dans_la_periode', count(*) filter (where commandes >= 2)
        )
        from clients
      )
    )
  );
end;
$$;

revoke execute on function pilotage_analyses(date, date, text) from public, anon, authenticated;
grant execute on function pilotage_analyses(date, date, text) to service_role;
