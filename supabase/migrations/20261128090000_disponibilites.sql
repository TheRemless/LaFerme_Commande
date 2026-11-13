-- Disponibilités des plats et ruptures planifiées (vague 3, bo-carte).
--
-- 1. Un plat de la carte peut être réservé à un service (midi ou soir), à un mode (livraison ou retrait)
--    et à certains jours de la semaine. Null : sans restriction. Le contrôle se fait au panier et au
--    paiement (src/lib/disponibilite.ts), selon le moment et le mode choisis par le client.
-- 2. rupture_jour (plats et options) se lit désormais « épuisé jusqu'au » : la tablette y met
--    aujourd'hui, comme avant ; le back-office peut y mettre une date plus lointaine. Le plat revient
--    seul le lendemain de cette date. « Remettre » sur la tablette (null) lève aussi une rupture planifiée.
-- 3. Rupture d'un poste entier (four en panne : toutes les pizzas) ou d'une catégorie, en un geste, jusqu'à
--    une date (table ruptures_groupees). Les ruptures plat par plat restent intactes quand on la lève.
--
-- Objets partagés recréés, chacun à partir de sa dernière définition dans main (cb87f12), avec seulement
-- les colonnes ajoutées en fin de liste et la rupture lue « ≥ aujourd'hui » :
--   vue carte_publique (20261118090000_carte_gestion), vue options_publiques (20261117090000_gerant_vague2),
--   fonctions plats_tablette (20261118090000_carte_gestion), options_tablette (20261117090000_gerant_vague2),
--   gestion_carte (20261118090000_carte_gestion).
-- Table neuve ruptures_groupees ; fonctions neuves fin_rupture (appelée par la vue, donc exécutable par
-- les visiteurs comme toute fonction par défaut), ruptures_groupees_actives, regler_rupture_groupee.
-- Compatibilité : le code d'avant la migration ignore les colonnes neuves ; le code d'après lit les
-- colonnes neuves comme absentes (aucune restriction) tant que la migration n'est pas passée.

-- ---------- Colonnes ----------

alter table plats add column dispo_service text check (dispo_service in ('midi', 'soir'));
alter table plats add column dispo_mode text check (dispo_mode in ('livraison', 'retrait'));
-- Jours ISO (1 = lundi … 7 = dimanche), triés, sans doublon ; null = tous les jours.
alter table plats add column dispo_jours smallint[];
alter table plats add constraint plats_dispo_jours_check check (
  dispo_jours is null or (cardinality(dispo_jours) between 1 and 6 and dispo_jours <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
);
-- Le plat du jour a déjà sa date et son service.
alter table plats add constraint plats_dispo_hors_jour check (origine <> 'jour' or (dispo_service is null and dispo_jours is null));

comment on column plats.rupture_jour is 'Épuisé jusqu''à cette date comprise (heure de Genève). Aujourd''hui : rupture du jour posée par la tablette.';
comment on column options.rupture_jour is 'Épuisé jusqu''à cette date comprise (heure de Genève). Aujourd''hui : rupture du jour posée par la tablette.';

-- Rupture d'un poste ou d'une catégorie : cible 'poste:pizza', 'poste:cuisine' ou 'categorie:<slug>'.
-- Lisible par tous (la carte publique la lit avec les droits du visiteur), écrite par le serveur seulement.
create table ruptures_groupees (
  cible text primary key check (cible ~ '^(poste:(pizza|cuisine)|categorie:[a-z0-9-]{1,40})$'),
  jusqu_au date not null
);
alter table ruptures_groupees enable row level security;
create policy "lecture publique" on ruptures_groupees for select to anon, authenticated using (true);
revoke all on ruptures_groupees from anon, authenticated;
grant select on ruptures_groupees to anon, authenticated;
grant select, insert, update, delete on ruptures_groupees to service_role;

-- Dernier jour où ce plat est épuisé (rupture du plat, de son poste ou de sa catégorie), ou null.
create function fin_rupture(p_rupture_jour date, p_station station, p_categorie text) returns date
language sql stable as $$
  select greatest(p_rupture_jour, (
    select max(r.jusqu_au) from ruptures_groupees r
    where r.cible in ('poste:' || p_station::text, 'categorie:' || p_categorie)
  ));
$$;

-- ---------- Vues lues par le site ----------

-- Même définition que 20261118090000_carte_gestion.sql. Ajouts en fin de liste : disponibilités et
-- rupture planifiée (date de fin quand elle dépasse aujourd'hui). rupture_motif garde son texte et ne
-- couvre qu'une rupture qui finit aujourd'hui (du plat, de son poste ou de sa catégorie) ; au-delà, le
-- site compare la date de fin au jour choisi par le client.
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
    then fin_rupture(p.rupture_jour, p.station, c.slug) end as rupture_jusqu_au
from plats p
join categories c on c.id = p.categorie_id
where p.jour is null or p.jour = (now() at time zone 'Europe/Zurich')::date;

-- Même définition que 20261117090000_gerant_vague2.sql, rupture lue « jusqu'au », date de fin en fin de liste.
create or replace view options_publiques with (security_invoker = true) as
select g.slug as groupe_slug, g.nom as groupe_nom, g.choix_min, g.choix_max,
       o.nom, o.prix_centimes, o.prix_a_valider, o.ordre,
       coalesce(o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date, false) as rupture,
       case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end as rupture_jusqu_au
from options o
join groupes_options g on g.id = o.groupe_id;

-- ---------- Tablette ----------

-- Même définition que 20261118090000_carte_gestion.sql, rupture lue « jusqu'au » (plat, poste ou
-- catégorie), date de fin et rupture groupée en plus.
create or replace function plats_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'nom', p.nom, 'categorie', c.nom,
    'rupture', coalesce(f.fin >= (now() at time zone 'Europe/Zurich')::date, false),
    'rupture_jusqu_au', case when f.fin >= (now() at time zone 'Europe/Zurich')::date then f.fin end,
    -- Rupture du poste ou de la catégorie : « Remettre » ce plat seul ne la lève pas.
    'rupture_groupee', (select r.cible from ruptures_groupees r
      where r.cible in ('poste:' || p.station::text, 'categorie:' || c.slug) and r.jusqu_au >= (now() at time zone 'Europe/Zurich')::date
      order by r.jusqu_au desc limit 1)
  ) order by c.ordre, p.ordre), '[]'::jsonb)
  from plats p join categories c on c.id = p.categorie_id
  cross join lateral (select fin_rupture(p.rupture_jour, p.station, c.slug) as fin) f
  where p.commandable and (p.jour is null or p.jour = (now() at time zone 'Europe/Zurich')::date);
$$;

-- Même définition que 20261117090000_gerant_vague2.sql, rupture lue « jusqu'au », date de fin en plus.
create or replace function options_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'groupe', g.slug, 'groupe_nom', g.nom, 'nom', o.nom,
    'rupture', coalesce(o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date, false),
    'rupture_jusqu_au', case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end
  ) order by g.slug, o.ordre), '[]'::jsonb)
  from options o join groupes_options g on g.id = o.groupe_id
  where o.actif and g.choix_min = 0;
$$;

-- ---------- Rupture d'un poste ou d'une catégorie ----------

-- Ruptures groupées en cours : [{ cible, jusqu_au }].
create function ruptures_groupees_actives() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('cible', cible, 'jusqu_au', jusqu_au) order by cible), '[]'::jsonb)
  from ruptures_groupees where jusqu_au >= (now() at time zone 'Europe/Zurich')::date;
$$;

-- Pose (jusqu'à une date comprise, d'aujourd'hui à 60 jours) ou lève (null) la rupture d'un poste ou d'une
-- catégorie. Tout membre actif, comme une rupture de la tablette ; un gérant est aussi noté au journal
-- du back-office.
create function regler_rupture_groupee(p_cible text, p_jusqu_au date, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  avant date;
begin
  if not exists (select 1 from personnel where id = p_personnel and actif) then
    raise exception 'personnel_inconnu';
  end if;
  if p_cible is null or p_cible !~ '^(poste:(pizza|cuisine)|categorie:[a-z0-9-]{1,40})$'
     or (p_cible like 'categorie:%' and not exists (select 1 from categories where slug = substr(p_cible, 11) and slug <> 'plat-du-jour')) then
    return false;
  end if;
  if p_jusqu_au is not null and (p_jusqu_au < aujourdhui or p_jusqu_au > aujourdhui + 60) then
    raise exception 'date_rupture';
  end if;
  select jusqu_au into avant from ruptures_groupees where cible = p_cible for update;
  if p_jusqu_au is null then
    delete from ruptures_groupees where cible = p_cible;
  else
    insert into ruptures_groupees (cible, jusqu_au) values (p_cible, p_jusqu_au)
      on conflict (cible) do update set jusqu_au = excluded.jusqu_au;
  end if;
  insert into journal_personnel (personnel_id, evenement)
    values (p_personnel, 'rupture groupee ' || p_cible || ' ' || coalesce(p_jusqu_au::text, 'levee'));
  if exists (select 1 from personnel where id = p_personnel and actif and role = 'gerant') then
    perform journaliser(p_personnel, 'rupture_groupee', p_cible,
      jsonb_build_object('jusqu_au', case when avant >= aujourdhui then avant end),
      jsonb_build_object('jusqu_au', p_jusqu_au));
  end if;
  return true;
end;
$$;

-- ---------- Back-office ----------

-- Même définition que 20261118090000_carte_gestion.sql. Ajouts : disponibilités et rupture planifiée de
-- chaque plat, rupture de chaque option.
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
        'options', coalesce((select jsonb_agg(jsonb_build_object('nom', o.nom, 'prix_centimes', o.prix_centimes, 'prix_a_valider', o.prix_a_valider, 'actif', o.actif,
          'rupture_jusqu_au', case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end) order by o.ordre) from options o where o.groupe_id = g.id), '[]'::jsonb)
      ) order by g.id)
      from groupes_options g
    ), '[]'::jsonb),
    'bloquants', (select count(distinct slug) from plats_bloquants),
    'ruptures_groupees', ruptures_groupees_actives()
  );
$$;

-- Disponibilités d'un plat de la carte : { service, mode, jours } (null ou absent = sans restriction).
-- Tous les jours cochés valent « sans restriction ». Aucun jour : refusé.
create function regler_disponibilite(p_slug text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant plats%rowtype;
  apres plats%rowtype;
  v_service text := nullif(p ->> 'service', '');
  v_mode text := nullif(p ->> 'mode', '');
  v_jours smallint[];
begin
  perform gerant_nom(p_personnel);
  if jsonb_typeof(p -> 'jours') = 'array' then
    if exists (select 1 from jsonb_array_elements(p -> 'jours') j where jsonb_typeof(j) <> 'number' or j::text !~ '^[1-7]$') then
      raise exception 'jours_invalides';
    end if;
    select array_agg(distinct j::text::smallint order by j::text::smallint) into v_jours from jsonb_array_elements(p -> 'jours') j;
    if v_jours is null then
      raise exception 'jours_vides';
    end if;
    if cardinality(v_jours) = 7 then
      v_jours := null;
    end if;
  elsif p ? 'jours' and jsonb_typeof(p -> 'jours') <> 'null' then
    raise exception 'jours_invalides';
  end if;
  if v_service is not null and v_service not in ('midi', 'soir') then
    raise exception 'service_invalide';
  end if;
  if v_mode is not null and v_mode not in ('livraison', 'retrait') then
    raise exception 'mode_invalide';
  end if;

  select * into avant from plats where slug = p_slug for update;
  if not found then
    return false;
  end if;
  if avant.origine = 'jour' and (v_service is not null or v_jours is not null) then
    raise exception 'plat_du_jour';
  end if;
  update plats set dispo_service = v_service, dispo_mode = v_mode, dispo_jours = v_jours
  where id = avant.id
  returning * into apres;
  perform journaliser(p_personnel, 'disponibilite', p_slug,
    jsonb_build_object('service', avant.dispo_service, 'mode', avant.dispo_mode, 'jours', to_jsonb(avant.dispo_jours)),
    jsonb_build_object('service', apres.dispo_service, 'mode', apres.dispo_mode, 'jours', to_jsonb(apres.dispo_jours)));
  return true;
end;
$$;

-- Rupture d'un plat jusqu'à une date comprise (aujourd'hui à 60 jours), ou null pour le remettre.
create function planifier_rupture(p_slug text, p_jusqu_au date, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant date;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
begin
  perform gerant_nom(p_personnel);
  if p_jusqu_au is not null and (p_jusqu_au < aujourdhui or p_jusqu_au > aujourdhui + 60) then
    raise exception 'date_rupture';
  end if;
  select rupture_jour into avant from plats where slug = p_slug for update;
  if not found then
    return false;
  end if;
  update plats set rupture_jour = p_jusqu_au where slug = p_slug;
  perform journaliser(p_personnel, 'rupture', p_slug,
    jsonb_build_object('jusqu_au', case when avant >= aujourdhui then avant end),
    jsonb_build_object('jusqu_au', p_jusqu_au));
  return true;
end;
$$;

-- Même chose pour une option (supplément, choix des pâtes).
create function planifier_rupture_option(p_groupe text, p_nom text, p_jusqu_au date, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  o_id uuid;
  avant date;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
begin
  perform gerant_nom(p_personnel);
  if p_jusqu_au is not null and (p_jusqu_au < aujourdhui or p_jusqu_au > aujourdhui + 60) then
    raise exception 'date_rupture';
  end if;
  select o.id, o.rupture_jour into o_id, avant
  from options o join groupes_options g on g.id = o.groupe_id
  where g.slug = p_groupe and o.nom = p_nom
  for update of o;
  if o_id is null then
    return false;
  end if;
  update options set rupture_jour = p_jusqu_au where id = o_id;
  perform journaliser(p_personnel, 'rupture_option', p_groupe || '/' || p_nom,
    jsonb_build_object('jusqu_au', case when avant >= aujourdhui then avant end),
    jsonb_build_object('jusqu_au', p_jusqu_au));
  return true;
end;
$$;

-- ---------- Droits ----------

revoke execute on function
  regler_disponibilite(text, jsonb, uuid), planifier_rupture(text, date, uuid),
  planifier_rupture_option(text, text, date, uuid), gestion_carte(), plats_tablette(), options_tablette(),
  ruptures_groupees_actives(), regler_rupture_groupee(text, date, uuid)
  from public, anon, authenticated;
grant execute on function
  regler_disponibilite(text, jsonb, uuid), planifier_rupture(text, date, uuid),
  planifier_rupture_option(text, text, date, uuid), gestion_carte(), plats_tablette(), options_tablette(),
  ruptures_groupees_actives(), regler_rupture_groupee(text, date, uuid)
  to service_role;
