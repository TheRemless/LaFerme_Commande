-- Groupes d'options gérés au back-office (vague 3, bo-carte) : créer un groupe (sauce au choix, cuisson,
-- accompagnement), régler son minimum et son maximum, options cochées d'avance, ordre et nom des options,
-- plats qui portent le groupe (un groupe se réutilise sur autant de plats qu'on veut).
--
-- Objets partagés recréés, depuis 20261210090000_disponibilites.sql (PR #55) :
--   vue options_publiques (+ par_defaut en fin de liste), fonction gestion_carte (+ par_defaut de chaque
--   option, plats de chaque groupe).
-- Compatible avant et après : par_defaut absent = aucune option cochée d'avance.

alter table options add column par_defaut boolean not null default false;

-- Même définition que 20261210090000_disponibilites.sql, + par_defaut en fin de liste.
create or replace view options_publiques with (security_invoker = true) as
select g.slug as groupe_slug, g.nom as groupe_nom, g.choix_min, g.choix_max,
       o.nom, o.prix_centimes, o.prix_a_valider, o.ordre,
       coalesce(o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date, false) as rupture,
       case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end as rupture_jusqu_au,
       o.par_defaut
from options o
join groupes_options g on g.id = o.groupe_id;

-- Même définition que 20261210090000_disponibilites.sql, + par_defaut de chaque option et plats de chaque groupe.
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
      'rupture_jusqu_au', case when p.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then p.rupture_jour end
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

-- Nom d'un groupe ou d'une option : espaces resserrés, 1 à 40 caractères (groupe) ou 60 (option).
create function nom_propre(p text, p_max integer) returns text
language plpgsql immutable as $$
declare
  n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if n = '' or length(n) > p_max then
    raise exception 'nom_invalide';
  end if;
  return n;
end;
$$;

-- Minimum et maximum d'un groupe : 0 à 10 obligatoires, 1 à 20 au plus, minimum ≤ maximum.
create function verifier_bornes(p_min integer, p_max integer) returns void
language plpgsql immutable as $$
begin
  if p_min is null or p_max is null or p_min < 0 or p_min > 10 or p_max < 1 or p_max > 20 or p_min > p_max then
    raise exception 'bornes_invalides';
  end if;
end;
$$;

-- Groupe neuf : { nom, choix_min, choix_max }. Slug proposé par le serveur (tiré du nom), suffixé s'il est pris.
-- Il ne porte aucune option ni aucun plat : on lui ajoute ses options (ajouter_option), puis ses plats.
create function ajouter_groupe(p_slug text, p jsonb, p_personnel uuid) returns text
language plpgsql as $$
declare
  n text;
  s text := p_slug;
  i integer := 1;
  v_min integer := (p ->> 'choix_min')::integer;
  v_max integer := (p ->> 'choix_max')::integer;
begin
  perform gerant_nom(p_personnel);
  n := nom_propre(p ->> 'nom', 40);
  perform verifier_bornes(v_min, v_max);
  if s is null or s !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'slug_invalide';
  end if;
  if exists (select 1 from groupes_options where lower(nom) = lower(n)) then
    raise exception 'groupe_existe';
  end if;
  while exists (select 1 from groupes_options where slug = s) loop
    i := i + 1;
    s := p_slug || '-' || i;
  end loop;
  insert into groupes_options (slug, nom, choix_min, choix_max) values (s, n, v_min, v_max);
  perform journaliser(p_personnel, 'groupe', s, null, jsonb_build_object('nom', n, 'choix_min', v_min, 'choix_max', v_max));
  return s;
end;
$$;

-- Nom, minimum et maximum d'un groupe (chaque champ facultatif). Refuse un minimum que les options en
-- vente ne peuvent pas remplir quand un plat en vente porte le groupe, et un maximum sous le nombre
-- d'options cochées d'avance.
create function modifier_groupe(p_slug text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant groupes_options%rowtype;
  apres groupes_options%rowtype;
  v_nom text;
  v_min integer;
  v_max integer;
begin
  perform gerant_nom(p_personnel);
  select * into avant from groupes_options where slug = p_slug for update;
  if not found then
    return false;
  end if;
  v_nom := case when p ? 'nom' then nom_propre(p ->> 'nom', 40) else avant.nom end;
  v_min := coalesce((p ->> 'choix_min')::integer, avant.choix_min);
  v_max := coalesce((p ->> 'choix_max')::integer, avant.choix_max);
  perform verifier_bornes(v_min, v_max);
  if lower(v_nom) <> lower(avant.nom) and exists (select 1 from groupes_options where lower(nom) = lower(v_nom) and id <> avant.id) then
    raise exception 'groupe_existe';
  end if;
  if v_min > (select count(*) from options where groupe_id = avant.id and actif)
     and exists (select 1 from plat_groupes pg join plats x on x.id = pg.plat_id where pg.groupe_id = avant.id and x.commandable) then
    raise exception 'choix_impossible';
  end if;
  if v_max < (select count(*) from options where groupe_id = avant.id and actif and par_defaut) then
    raise exception 'trop_de_defauts';
  end if;
  update groupes_options set nom = v_nom, choix_min = v_min, choix_max = v_max where id = avant.id returning * into apres;
  perform journaliser(p_personnel, 'groupe', p_slug,
    jsonb_build_object('nom', avant.nom, 'choix_min', avant.choix_min, 'choix_max', avant.choix_max),
    jsonb_build_object('nom', apres.nom, 'choix_min', apres.choix_min, 'choix_max', apres.choix_max));
  return true;
end;
$$;

-- Options cochées d'avance sur la fiche du client (« Frites » pour l'accompagnement). Au plus le maximum
-- du groupe, options en vente seulement. Le client peut toujours les décocher.
create function regler_defauts(p_groupe text, p_noms text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  g groupes_options%rowtype;
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select * into g from groupes_options where slug = p_groupe for update;
  if not found then
    return false;
  end if;
  p_noms := coalesce(p_noms, '{}');
  if cardinality(p_noms) > g.choix_max then
    raise exception 'trop_de_defauts';
  end if;
  if exists (select 1 from unnest(p_noms) n where not exists (select 1 from options o where o.groupe_id = g.id and o.nom = n and o.actif)) then
    raise exception 'option_inconnue';
  end if;
  select coalesce(jsonb_agg(nom order by ordre), '[]'::jsonb) into avant from options where groupe_id = g.id and par_defaut;
  update options set par_defaut = (nom = any (p_noms)) where groupe_id = g.id;
  perform journaliser(p_personnel, 'groupe_defauts', p_groupe, jsonb_build_object('par_defaut', avant),
    jsonb_build_object('par_defaut', (select coalesce(jsonb_agg(nom order by ordre), '[]'::jsonb) from options where groupe_id = g.id and par_defaut)));
  return true;
end;
$$;

-- Ordre des options d'un groupe ; celles qui ne sont pas nommées suivent dans leur ordre.
create function ordonner_options(p_groupe text, p_noms text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  gid smallint;
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select id into gid from groupes_options where slug = p_groupe;
  if gid is null then
    return false;
  end if;
  select coalesce(jsonb_agg(nom order by ordre, nom), '[]'::jsonb) into avant from options where groupe_id = gid;
  update options o set ordre = r.rang
  from (
    select x.id, (row_number() over (order by coalesce(array_position(p_noms, x.nom), 100000), x.ordre, x.nom))::smallint as rang
    from options x where x.groupe_id = gid
  ) r
  where o.id = r.id and o.groupe_id = gid;
  perform journaliser(p_personnel, 'groupe_ordre', p_groupe, jsonb_build_object('ordre', avant),
    jsonb_build_object('ordre', (select jsonb_agg(nom order by ordre) from options where groupe_id = gid)));
  return true;
end;
$$;

-- Renommer une option. Les commandes passées gardent le nom choisi alors (copié dans la ligne).
create function renommer_option(p_groupe text, p_ancien text, p_nouveau text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  gid smallint;
  n text;
begin
  perform gerant_nom(p_personnel);
  n := nom_propre(p_nouveau, 60);
  select id into gid from groupes_options where slug = p_groupe;
  if gid is null or not exists (select 1 from options where groupe_id = gid and nom = p_ancien) then
    return false;
  end if;
  if lower(n) <> lower(p_ancien) and exists (select 1 from options where groupe_id = gid and lower(nom) = lower(n)) then
    raise exception 'option_existe';
  end if;
  update options set nom = n where groupe_id = gid and nom = p_ancien;
  perform journaliser(p_personnel, 'option_nom', p_groupe || '/' || n, jsonb_build_object('nom', p_ancien), jsonb_build_object('nom', n));
  return true;
end;
$$;

-- Plats qui portent ce groupe (liste complète : les plats absents le perdent). Un plat ajouté au
-- back-office et en vente ne peut pas recevoir un groupe qui le rendrait incomplet (même verrou que
-- modifier_plat).
create function lier_groupe(p_groupe text, p_slugs text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  gid smallint;
  avant jsonb;
  r record;
begin
  perform gerant_nom(p_personnel);
  select id into gid from groupes_options where slug = p_groupe;
  if gid is null then
    return false;
  end if;
  p_slugs := coalesce(p_slugs, '{}');
  if exists (select 1 from unnest(p_slugs) s where not exists (select 1 from plats where slug = s)) then
    raise exception 'plat_inconnu';
  end if;
  select coalesce(jsonb_agg(p.slug order by p.slug), '[]'::jsonb) into avant
    from plat_groupes pg join plats p on p.id = pg.plat_id where pg.groupe_id = gid;
  delete from plat_groupes pg using plats p where pg.plat_id = p.id and pg.groupe_id = gid and not (p.slug = any (p_slugs));
  insert into plat_groupes (plat_id, groupe_id, ordre)
    select p.id, gid, coalesce((select max(x.ordre) + 1 from plat_groupes x where x.plat_id = p.id), 1)
    from plats p where p.slug = any (p_slugs)
    on conflict do nothing;
  for r in select p.id, p.nom from plats p where p.slug = any (p_slugs) and p.origine <> 'carte' and p.commandable loop
    if cardinality(motifs_plat(r.id)) > 0 then
      raise exception 'plat_incomplet: % : %', r.nom, array_to_string(motifs_plat(r.id), ', ');
    end if;
  end loop;
  perform journaliser(p_personnel, 'groupe_plats', p_groupe, jsonb_build_object('plats', avant),
    jsonb_build_object('plats', (select coalesce(jsonb_agg(p.slug order by p.slug), '[]'::jsonb) from plat_groupes pg join plats p on p.id = pg.plat_id where pg.groupe_id = gid)));
  return true;
end;
$$;

-- ---------- Droits ----------

revoke execute on function
  gestion_carte(), nom_propre(text, integer), verifier_bornes(integer, integer), ajouter_groupe(text, jsonb, uuid),
  modifier_groupe(text, jsonb, uuid), regler_defauts(text, text[], uuid), ordonner_options(text, text[], uuid),
  renommer_option(text, text, text, uuid), lier_groupe(text, text[], uuid)
  from public, anon, authenticated;
grant execute on function
  gestion_carte(), nom_propre(text, integer), verifier_bornes(integer, integer), ajouter_groupe(text, jsonb, uuid),
  modifier_groupe(text, jsonb, uuid), regler_defauts(text, text[], uuid), ordonner_options(text, text[], uuid),
  renommer_option(text, text, text, uuid), lier_groupe(text, text[], uuid)
  to service_role;
