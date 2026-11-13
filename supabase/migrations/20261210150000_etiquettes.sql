-- Étiquettes des plats (vague 3, bo-carte) : végétarien, végane, épicé. Posées par le gérant, plat par
-- plat ; le site n'en déduit aucune (ni de la description ni des allergènes). Sans saisie, pas d'étiquette.
-- Elles servent au filtre de la carte (client-commande) et s'affichent sur la fiche.
--
-- Objets partagés recréés : vue carte_publique (depuis 20261210090000_disponibilites, + etiquettes en fin de
-- liste), fonction gestion_carte (depuis 20261210100000_groupes_options, + etiquettes de chaque plat).
-- Compatible avant et après : etiquettes absente = aucune étiquette.

alter table plats add column etiquettes text[] not null default '{}'
  check (etiquettes <@ array['vegetarien', 'vegane', 'epice']::text[]);

-- Même définition que 20261210090000_disponibilites.sql, + etiquettes en fin de liste.
create or replace view carte_publique with (security_invoker = true) as
select
  c.slug as categorie_slug,
  c.nom as categorie_nom,
  c.ordre as categorie_ordre,
  p.slug,
  p.nom,
  p.description,
  p.prix_centimes,
  p.prix_a_valider,
  p.photo,
  p.ordre,
  coalesce(
    p.rupture_motif,
    case when fin_rupture(p.rupture_jour, p.station, c.slug) = (now() at time zone 'Europe/Zurich')::date then 'Épuisé pour aujourd''hui.' end
  ) as rupture_motif,
  p.provenance,
  p.provenances_a_fournir,
  p.allergenes,
  exists (select 1 from plat_groupes g where g.plat_id = p.id)
    or exists (select 1 from plat_retraits r where r.plat_id = p.id) as a_options,
  p.station,
  p.jour,
  p.jour_service,
  p.dispo_service,
  p.dispo_mode,
  p.dispo_jours,
  case when fin_rupture(p.rupture_jour, p.station, c.slug) > (now() at time zone 'Europe/Zurich')::date
    then fin_rupture(p.rupture_jour, p.station, c.slug) end as rupture_jusqu_au,
  p.etiquettes
from plats p
join categories c on c.id = p.categorie_id
where p.jour is null or p.jour = (now() at time zone 'Europe/Zurich')::date;

-- Même définition que 20261210100000_groupes_options.sql, + etiquettes de chaque plat.
create or replace function gestion_carte() returns jsonb
language sql stable as $$
  with fiches as (
    select p.*, jsonb_build_object(
      'slug', p.slug, 'nom', p.nom, 'description', p.description, 'prix_centimes', p.prix_centimes,
      'prix_a_valider', p.prix_a_valider, 'commandable', p.commandable, 'station', p.station, 'photo', p.photo,
      'provenance', p.provenance, 'provenances_a_fournir', to_jsonb(p.provenances_a_fournir), 'allergenes', p.allergenes,
      'origine', p.origine, 'archive', p.archive_le is not null, 'jour', p.jour, 'jour_service', p.jour_service,
      'retraits', coalesce((select jsonb_agg(jsonb_build_object('nom', r.nom, 'a_valider', r.a_valider) order by r.ordre) from plat_retraits r where r.plat_id = p.id), '[]'::jsonb),
      'groupes', coalesce((select jsonb_agg(g.slug order by pg.ordre) from plat_groupes pg join groupes_options g on g.id = pg.groupe_id where pg.plat_id = p.id), '[]'::jsonb),
      -- Ce qui bloquerait la mise en ligne si le plat était en vente, et ce qui la bloque déjà
      -- (même règle que la vue plats_bloquants, sans la relire pour chaque plat).
      'manques', to_jsonb(m.manques),
      'bloquants', case when p.commandable and (p.jour is null or p.jour >= (now() at time zone 'Europe/Zurich')::date)
        then to_jsonb(m.manques) else '[]'::jsonb end,
      'dispo', jsonb_build_object('service', p.dispo_service, 'mode', p.dispo_mode, 'jours', to_jsonb(p.dispo_jours)),
      'rupture_jusqu_au', case when p.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then p.rupture_jour end,
      'etiquettes', to_jsonb(p.etiquettes)
    ) as fiche
    from plats p
    cross join lateral (select motifs_plat(p.id) as manques) m
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'nom', c.nom,
        'plats', coalesce((select jsonb_agg(f.fiche order by f.ordre, f.nom) from fiches f where f.categorie_id = c.id), '[]'::jsonb)
      ) order by c.ordre)
      from categories c where c.slug <> 'plat-du-jour'
    ), '[]'::jsonb),
    -- Plats du jour d'aujourd'hui et à venir, puis ceux des sept derniers jours.
    'plats_du_jour', coalesce((
      select jsonb_agg(f.fiche order by f.jour desc, f.jour_service, f.nom)
      from fiches f
      where f.origine = 'jour' and f.jour >= (now() at time zone 'Europe/Zurich')::date - 7
    ), '[]'::jsonb),
    'aujourdhui', (now() at time zone 'Europe/Zurich')::date,
    'groupes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', g.slug, 'nom', g.nom, 'choix_min', g.choix_min, 'choix_max', g.choix_max,
        'plats', coalesce((select jsonb_agg(p.slug order by p.nom) from plat_groupes pg join plats p on p.id = pg.plat_id where pg.groupe_id = g.id and p.archive_le is null), '[]'::jsonb),
        'options', coalesce((select jsonb_agg(jsonb_build_object('nom', o.nom, 'prix_centimes', o.prix_centimes, 'prix_a_valider', o.prix_a_valider, 'actif', o.actif,
          'rupture_jusqu_au', case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end,
          'par_defaut', o.par_defaut) order by o.ordre) from options o where o.groupe_id = g.id), '[]'::jsonb)
      ) order by g.id)
      from groupes_options g
    ), '[]'::jsonb),
    'bloquants', (select count(distinct slug) from plats_bloquants),
    'ruptures_groupees', ruptures_groupees_actives()
  );
$$;

-- Étiquettes d'un plat (liste complète). Végane implique végétarien : la base l'ajoute.
create function regler_etiquettes(p_slug text, p_etiquettes text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant text[];
  v text[];
begin
  perform gerant_nom(p_personnel);
  select etiquettes into avant from plats where slug = p_slug for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from unnest(coalesce(p_etiquettes, '{}')) e where e not in ('vegetarien', 'vegane', 'epice')) then
    raise exception 'etiquette_inconnue';
  end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v
    from unnest(coalesce(p_etiquettes, '{}') || case when 'vegane' = any (p_etiquettes) then array['vegetarien'] else '{}' end) e;
  update plats set etiquettes = v where slug = p_slug;
  perform journaliser(p_personnel, 'etiquettes', p_slug, jsonb_build_object('etiquettes', to_jsonb(avant)), jsonb_build_object('etiquettes', to_jsonb(v)));
  return true;
end;
$$;

revoke execute on function regler_etiquettes(text, text[], uuid), gestion_carte() from public, anon, authenticated;
grant execute on function regler_etiquettes(text, text[], uuid), gestion_carte() to service_role;
