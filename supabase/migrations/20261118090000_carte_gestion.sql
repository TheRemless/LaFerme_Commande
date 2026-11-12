-- Carte gérée sans développeur, depuis le back-office (gérant seulement, tout est journalisé) :
--   ajouter un plat, le retirer de la vente, l'archiver et le remettre ;
--   ajouter, renommer, réordonner une catégorie, réordonner les plats, changer un plat de catégorie ;
--   ajouter un supplément à un groupe existant ;
--   envoyer une photo (stockée en base, redimensionnée par le serveur), la retirer ;
--   plat du jour : plat éphémère pour une date et un service, en tête de la carte ce jour-là.
-- Un plat ajouté par le gérant ne peut être en vente que s'il ne bloque pas la mise en ligne
-- (mêmes motifs que la vue plats_bloquants). Les commandes passées copient nom, poste et prix
-- (commande_lignes) : archiver un plat ne les touche pas, ni l'export comptable.
-- Toutes les fonctions sont réservées au rôle service_role (le serveur du site).
--
-- Objets partagés recréés, chacun à partir de sa dernière définition dans origin/main (revérifié après rebase
-- sur 2e7b55f : aucune n'a été recréée depuis) : vue carte_publique (20261109090000_tablette, + filtre du jour, + colonnes
-- jour et jour_service en fin), vue plats_bloquants (20261105120000_carte, mêmes colonnes et motifs),
-- fonctions plats_tablette (20261109090000_tablette), gestion_carte et modifier_plat (20261110090000_gestion).
-- Contrainte journal_gestion_objet_check : inchangée (contrôle de forme de 20261117090000_gerant_vague2).

-- ---------- Colonnes ----------

-- carte : plat de la carte d'origine (amorçage) ; gestion : ajouté au back-office ; jour : plat du jour.
alter table plats add column origine text not null default 'carte' check (origine in ('carte', 'gestion', 'jour'));
-- Archivé : hors de la vente et rangé à part dans le back-office. Jamais supprimé.
alter table plats add column archive_le timestamptz;
-- Plat du jour : sa date (heure de Genève) et son service.
alter table plats add column jour date;
alter table plats add column jour_service text check (jour_service in ('midi', 'soir', 'journee'));
alter table plats add constraint plats_archive_hors_vente check (archive_le is null or not commandable);
alter table plats add constraint plats_jour_complet check (
  (origine = 'jour') = (jour is not null) and (jour is null) = (jour_service is null)
);

-- Catégorie réservée aux plats du jour, toujours en tête (ordre 0, jamais réordonnée).
insert into categories (slug, nom, ordre) values ('plat-du-jour', 'Plat du jour', 0) on conflict (slug) do nothing;

-- Photos envoyées depuis le back-office. Fichier JPEG déjà redimensionné par le serveur.
-- Aucune lecture ni écriture publique : le site les sert par sa propre adresse /photos/<id>.jpg.
create table photos_plats (
  id uuid primary key default gen_random_uuid(),
  plat_slug text not null,
  largeur integer not null check (largeur between 1 and 4000),
  hauteur integer not null check (hauteur between 1 and 4000),
  octets integer not null check (octets between 1 and 3000000),
  donnees bytea not null,
  envoye_par uuid references personnel (id) on delete set null,
  cree_le timestamptz not null default now()
);
alter table photos_plats enable row level security;
revoke all on photos_plats from anon, authenticated;

-- Objets de journal « plat_ajoute », « plat_archive », « categorie », « photo », « plat_du_jour » : déjà
-- permis par le contrôle de forme posé par 20261117090000_gerant_vague2 (objet ~ '^[a-z_]{2,30}$').
-- Aucun n'est annulable depuis le journal (annuler_journal répond « non_annulable »).

-- ---------- Ce qui bloque un plat ----------

-- Motifs qui empêchent un plat d'être en ligne, qu'il soit en vente ou non. Source unique de la vue
-- plats_bloquants (verrou du build de production) et de la règle des plats ajoutés au back-office.
create function motifs_plat(p_id uuid) returns text[]
language sql stable as $$
  select coalesce(array_agg(x.motif order by x.rang, x.motif), '{}')
  from (
    select 1 as rang, 'prix à valider' as motif from plats p where p.id = p_id and p.prix_a_valider
    union all
    select 2, 'allergènes manquants' from plats p where p.id = p_id and coalesce(p.allergenes, '') = ''
    union all
    select 3, 'provenance à fournir' from plats p where p.id = p_id and cardinality(p.provenances_a_fournir) > 0
    union all
    select distinct 4, 'supplément à valider : ' || o.nom
    from plat_groupes g join options o on o.groupe_id = g.groupe_id and o.actif and o.prix_a_valider
    where g.plat_id = p_id
    union all
    select 5, 'retraits à valider' where exists (select 1 from plat_retraits r where r.plat_id = p_id and r.a_valider)
  ) x;
$$;

-- Mêmes colonnes et mêmes motifs qu'avant. Un plat du jour passé n'est plus vendu : il ne bloque rien.
create or replace view plats_bloquants with (security_invoker = true) as
select p.slug, p.nom, m.motif
from plats p
cross join lateral unnest(motifs_plat(p.id)) as m(motif)
where p.commandable and (p.jour is null or p.jour >= (now() at time zone 'Europe/Zurich')::date);
revoke all on plats_bloquants from anon, authenticated;

-- Filet de sécurité : un plat ajouté au back-office (ou un plat du jour) n'est jamais mis en vente
-- incomplet. Seuls la mise en vente et les champs du verrou comptent : une rupture posée depuis la
-- tablette passe toujours.
create function verifier_plat_en_vente() returns trigger
language plpgsql as $$
declare
  m text[];
begin
  if new.origine <> 'carte' and new.commandable and (
    tg_op = 'INSERT'
    or not old.commandable
    or old.prix_a_valider is distinct from new.prix_a_valider
    or old.allergenes is distinct from new.allergenes
    or old.provenances_a_fournir is distinct from new.provenances_a_fournir
  ) then
    m := motifs_plat(new.id);
    if cardinality(m) > 0 then
      raise exception 'plat_incomplet: %', array_to_string(m, ', ');
    end if;
  end if;
  return null;
end;
$$;
create trigger plats_en_vente_complets after insert or update on plats
  for each row execute function verifier_plat_en_vente();

-- ---------- Ce que voit le client ----------

-- Même vue qu'au lot 7 ; un plat du jour n'apparaît que le jour dit (heure de Genève), puis disparaît seul.
-- Colonnes ajoutées en fin de liste (create or replace view).
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
    case when p.rupture_jour = (now() at time zone 'Europe/Zurich')::date then 'Épuisé pour aujourd''hui.' end
  ) as rupture_motif,
  p.provenance,
  p.provenances_a_fournir,
  p.allergenes,
  exists (select 1 from plat_groupes g where g.plat_id = p.id)
    or exists (select 1 from plat_retraits r where r.plat_id = p.id) as a_options,
  p.station,
  p.jour,
  p.jour_service
from plats p
join categories c on c.id = p.categorie_id
where p.jour is null or p.jour = (now() at time zone 'Europe/Zurich')::date;

-- Ruptures de la tablette : sans les plats du jour des autres jours.
create or replace function plats_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'nom', p.nom, 'categorie', c.nom,
    'rupture', p.rupture_jour = (now() at time zone 'Europe/Zurich')::date
  ) order by c.ordre, p.ordre), '[]'::jsonb)
  from plats p join categories c on c.id = p.categorie_id
  where p.commandable and (p.jour is null or p.jour = (now() at time zone 'Europe/Zurich')::date);
$$;

-- ---------- Lecture du back-office ----------

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
        then to_jsonb(m.manques) else '[]'::jsonb end
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
        'options', coalesce((select jsonb_agg(jsonb_build_object('nom', o.nom, 'prix_centimes', o.prix_centimes, 'prix_a_valider', o.prix_a_valider, 'actif', o.actif) order by o.ordre) from options o where o.groupe_id = g.id), '[]'::jsonb)
      ) order by g.id)
      from groupes_options g
    ), '[]'::jsonb),
    'bloquants', (select count(distinct slug) from plats_bloquants)
  );
$$;

-- ---------- Plats ----------

-- Slug libre : le slug proposé, sinon suivi de -2, -3… (les commandes passées gardent l'ancien).
create function slug_libre(p_base text) returns text
language plpgsql stable as $$
declare
  s text := p_base;
  i integer := 1;
begin
  if p_base !~ '^[a-z0-9-]{1,70}$' then
    raise exception 'slug_invalide';
  end if;
  -- Un slug déjà vu dans une commande n'est jamais réutilisé : « recommander » retrouverait un autre plat.
  while exists (select 1 from plats where slug = s) or exists (select 1 from commande_lignes where plat_slug = s) loop
    i := i + 1;
    s := p_base || '-' || i;
  end loop;
  return s;
end;
$$;

-- Texte propre d'une clé jsonb, ou null.
create function texte_jsonb(p jsonb, p_cle text, p_max integer) returns text
language plpgsql immutable as $$
declare
  t text := nullif(btrim(regexp_replace(coalesce(p ->> p_cle, ''), '[ \t]+', ' ', 'g')), '');
begin
  if length(t) > p_max then
    raise exception 'texte_trop_long: %', p_cle;
  end if;
  return t;
end;
$$;

-- Retraits et groupes d'options d'un plat neuf, depuis p.retraits (noms) et p.groupes (slugs).
create function remplir_plat(p_id uuid, p jsonb) returns void
language plpgsql as $$
declare
  g text;
  n integer := 0;
begin
  insert into plat_retraits (plat_id, nom, ordre, a_valider)
    select p_id, btrim(x.nom), (x.i - 1)::smallint, false
    from jsonb_array_elements_text(coalesce(p -> 'retraits', '[]'::jsonb)) with ordinality as x(nom, i)
    where btrim(x.nom) <> ''
    on conflict (plat_id, nom) do nothing;
  for g in select jsonb_array_elements_text(coalesce(p -> 'groupes', '[]'::jsonb)) loop
    n := n + 1;
    insert into plat_groupes (plat_id, groupe_id, ordre)
      select p_id, go.id, n::smallint from groupes_options go where go.slug = g
      on conflict do nothing;
    if not found then
      raise exception 'groupe_inconnu';
    end if;
  end loop;
end;
$$;

-- Nouveau plat de la carte. Il naît hors de la vente ; il n'est mis en vente tout de suite que si on le
-- demande (p.commandable) et que rien ne le bloque. Renvoie le slug et ce qui manque.
-- p = { slug, categorie, nom, description, prix_centimes, prix_valide, station, provenance,
--       provenances_a_fournir, allergenes, retraits, groupes, commandable }
create function ajouter_plat(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  cat categories%rowtype;
  s text;
  pid uuid;
  m text[];
  apres plats%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into cat from categories where slug = p ->> 'categorie';
  if not found or cat.slug = 'plat-du-jour' then
    raise exception 'categorie_inconnue';
  end if;
  if texte_jsonb(p, 'nom', 80) is null then
    raise exception 'nom_invalide';
  end if;
  s := slug_libre(p ->> 'slug');
  insert into plats (slug, categorie_id, nom, description, prix_centimes, prix_a_valider, commandable, station,
                     ordre, provenance, provenances_a_fournir, allergenes, origine)
  values (
    s, cat.id, texte_jsonb(p, 'nom', 80), coalesce(texte_jsonb(p, 'description', 400), ''),
    (p ->> 'prix_centimes')::integer, not coalesce((p ->> 'prix_valide')::boolean, false), false,
    (p ->> 'station')::station,
    coalesce((select max(ordre) + 1 from plats where categorie_id = cat.id), 1),
    texte_jsonb(p, 'provenance', 300),
    coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p -> 'provenances_a_fournir', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
    texte_jsonb(p, 'allergenes', 300),
    'gestion'
  )
  returning id into pid;
  perform remplir_plat(pid, p);
  m := motifs_plat(pid);
  if coalesce((p ->> 'commandable')::boolean, false) and cardinality(m) = 0 then
    update plats set commandable = true where id = pid;
  end if;
  select * into apres from plats where id = pid;
  -- Objet à part : une création ne s'annule pas depuis le journal (annuler_journal n'y touche pas).
  perform journaliser(p_personnel, 'plat_ajoute', s, null, to_jsonb(apres) - 'id' - 'cree_le' - 'modifie_le'
    || jsonb_build_object('retraits', coalesce(p -> 'retraits', '[]'::jsonb), 'groupes', coalesce(p -> 'groupes', '[]'::jsonb)));
  return jsonb_build_object('slug', s, 'commandable', apres.commandable, 'manques', to_jsonb(m));
end;
$$;

-- Champs modifiables d'un plat (même contrat qu'au lot 7b), plus « categorie » (changer de catégorie)
-- et « groupes » (options et suppléments proposés). Une photo envoyée doit exister.
create or replace function modifier_plat(p_slug text, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  avant plats%rowtype;
  apres plats%rowtype;
  cat categories%rowtype;
  groupes_avant jsonb;
  g text;
  n integer := 0;
begin
  perform gerant_nom(p_personnel);
  select * into avant from plats where slug = p_slug for update;
  if not found then
    return null;
  end if;
  if p ? 'categorie' then
    select * into cat from categories where slug = p ->> 'categorie';
    if not found or cat.slug = 'plat-du-jour' or avant.origine = 'jour' then
      raise exception 'categorie_inconnue';
    end if;
  end if;
  if p ? 'commandable' and (p ->> 'commandable')::boolean and avant.archive_le is not null then
    raise exception 'plat_archive';
  end if;
  -- Une photo envoyée ne se pose que sur le plat pour lequel elle a été envoyée.
  if p ? 'photo' and (p ->> 'photo') ~ '^[0-9a-f-]{36}\.jpg$'
     and not exists (select 1 from photos_plats f where f.id::text || '.jpg' = p ->> 'photo' and f.plat_slug = p_slug) then
    raise exception 'photo_inconnue';
  end if;
  update plats set
    nom = coalesce(p ->> 'nom', nom),
    description = coalesce(p ->> 'description', description),
    prix_centimes = coalesce((p ->> 'prix_centimes')::integer, prix_centimes),
    -- Plat du jour : son prix est valable dès la saisie, il ne repart jamais à valider.
    prix_a_valider = case
      when avant.origine = 'jour' then false
      when p ? 'prix_valide' then not (p ->> 'prix_valide')::boolean
      when p ? 'prix_centimes' and (p ->> 'prix_centimes')::integer <> avant.prix_centimes then true
      else prix_a_valider end,
    commandable = coalesce((p ->> 'commandable')::boolean, commandable),
    station = coalesce((p ->> 'station')::station, station),
    photo = case when p ? 'photo' then nullif(p ->> 'photo', '') else photo end,
    provenance = case when p ? 'provenance' then nullif(p ->> 'provenance', '') else provenance end,
    provenances_a_fournir = case when p ? 'provenances_a_fournir'
      then array(select jsonb_array_elements_text(p -> 'provenances_a_fournir')) else provenances_a_fournir end,
    allergenes = case when p ? 'allergenes' then nullif(p ->> 'allergenes', '') else allergenes end,
    categorie_id = case when p ? 'categorie' then cat.id else categorie_id end,
    ordre = case when p ? 'categorie' and cat.id <> avant.categorie_id
      then coalesce((select max(x.ordre) + 1 from plats x where x.categorie_id = cat.id), 1) else ordre end
  where id = avant.id
  returning * into apres;
  if p ? 'groupes' then
    select coalesce(jsonb_agg(go.slug order by pg.ordre), '[]'::jsonb) into groupes_avant
      from plat_groupes pg join groupes_options go on go.id = pg.groupe_id where pg.plat_id = avant.id;
    delete from plat_groupes where plat_id = avant.id;
    for g in select jsonb_array_elements_text(p -> 'groupes') loop
      n := n + 1;
      insert into plat_groupes (plat_id, groupe_id, ordre)
        select avant.id, go.id, n::smallint from groupes_options go where go.slug = g on conflict do nothing;
      if not found then
        raise exception 'groupe_inconnu';
      end if;
    end loop;
    -- Un supplément à valider peut rendre le plat incomplet : même règle que pour les autres champs.
    if apres.origine <> 'carte' and apres.commandable and cardinality(motifs_plat(apres.id)) > 0 then
      raise exception 'plat_incomplet: %', array_to_string(motifs_plat(apres.id), ', ');
    end if;
  end if;
  perform nettoyer_photos();
  perform journaliser(p_personnel, 'plat', p_slug,
    to_jsonb(avant) - 'id' - 'cree_le' - 'modifie_le' || case when p ? 'groupes' then jsonb_build_object('groupes', groupes_avant) else '{}'::jsonb end,
    to_jsonb(apres) - 'id' - 'cree_le' - 'modifie_le' || case when p ? 'groupes' then jsonb_build_object('groupes', p -> 'groupes') else '{}'::jsonb end);
  return to_jsonb(apres) - 'id';
end;
$$;

-- Retirer un plat de la carte sans le supprimer : hors de la vente, rangé à part. Remettre le range à
-- nouveau dans sa catégorie, toujours hors de la vente (on le remet en vente d'un geste de plus).
create function archiver_plat(p_slug text, p_archiver boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant plats%rowtype;
  apres plats%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from plats where slug = p_slug for update;
  if not found then
    return false;
  end if;
  update plats set
    archive_le = case when p_archiver then coalesce(archive_le, now()) else null end,
    commandable = case when p_archiver then false else commandable end
  where id = avant.id
  returning * into apres;
  -- Objet à part : annuler_journal (objet « plat ») ne doit pas lire ces lignes partielles.
  perform journaliser(p_personnel, 'plat_archive', p_slug,
    jsonb_build_object('archive', avant.archive_le is not null, 'commandable', avant.commandable),
    jsonb_build_object('archive', apres.archive_le is not null, 'commandable', apres.commandable));
  return true;
end;
$$;

-- Ordre des plats d'une catégorie : la liste donnée, dans cet ordre ; les plats absents de la liste suivent.
create function ordonner_plats(p_categorie text, p_slugs text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  cid smallint;
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select id into cid from categories where slug = p_categorie and slug <> 'plat-du-jour';
  if cid is null then
    return false;
  end if;
  select coalesce(jsonb_agg(slug order by ordre, nom), '[]'::jsonb) into avant from plats where categorie_id = cid;
  update plats p set ordre = o.rang
  from (
    select x.id, (row_number() over (order by coalesce(array_position(p_slugs, x.slug), 100000), x.ordre, x.nom))::smallint as rang
    from plats x where x.categorie_id = cid
  ) o
  where p.id = o.id and p.categorie_id = cid;
  perform journaliser(p_personnel, 'categorie', p_categorie, jsonb_build_object('ordre_plats', avant),
    jsonb_build_object('ordre_plats', (select jsonb_agg(slug order by ordre) from plats where categorie_id = cid)));
  return true;
end;
$$;

-- ---------- Catégories ----------

create function ajouter_categorie(p_slug text, p_nom text, p_personnel uuid) returns text
language plpgsql as $$
declare
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
  s text := p_slug;
  i integer := 1;
begin
  perform gerant_nom(p_personnel);
  if n = '' or length(n) > 40 then
    raise exception 'nom_invalide';
  end if;
  if exists (select 1 from categories where lower(nom) = lower(n)) then
    raise exception 'categorie_existe';
  end if;
  if p_slug !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'slug_invalide';
  end if;
  while exists (select 1 from categories where slug = s) loop
    i := i + 1;
    s := p_slug || '-' || i;
  end loop;
  insert into categories (slug, nom, ordre)
    values (s, n, coalesce((select max(ordre) + 1 from categories), 1));
  perform journaliser(p_personnel, 'categorie', s, null, jsonb_build_object('nom', n));
  return s;
end;
$$;

-- Le slug reste : les liens vers la catégorie (#pizzas) et les plats ne bougent pas.
create function renommer_categorie(p_slug text, p_nom text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
  avant text;
begin
  perform gerant_nom(p_personnel);
  if n = '' or length(n) > 40 then
    raise exception 'nom_invalide';
  end if;
  select nom into avant from categories where slug = p_slug and slug <> 'plat-du-jour' for update;
  if avant is null then
    return false;
  end if;
  if exists (select 1 from categories where lower(nom) = lower(n) and slug <> p_slug) then
    raise exception 'categorie_existe';
  end if;
  update categories set nom = n where slug = p_slug;
  perform journaliser(p_personnel, 'categorie', p_slug, jsonb_build_object('nom', avant), jsonb_build_object('nom', n));
  return true;
end;
$$;

-- Ordre des catégories : la liste donnée ; le plat du jour reste toujours en tête.
create function ordonner_categories(p_slugs text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select jsonb_agg(slug order by ordre) into avant from categories where slug <> 'plat-du-jour';
  update categories c set ordre = o.rang
  from (
    select x.id, (row_number() over (order by coalesce(array_position(p_slugs, x.slug), 100000), x.ordre))::smallint as rang
    from categories x where x.slug <> 'plat-du-jour'
  ) o
  where c.id = o.id and c.slug <> 'plat-du-jour';
  perform journaliser(p_personnel, 'categorie', 'ordre', jsonb_build_object('ordre', avant),
    jsonb_build_object('ordre', (select jsonb_agg(slug order by ordre) from categories where slug <> 'plat-du-jour')));
  return true;
end;
$$;

-- ---------- Suppléments ----------

-- Nouvelle option d'un groupe existant (supplément de pizza, choix des pâtes). Prix à valider sauf
-- validation explicite, comme les autres.
create function ajouter_option(p_groupe text, p_nom text, p_prix_centimes integer, p_prix_valide boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  gid smallint;
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
begin
  perform gerant_nom(p_personnel);
  select id into gid from groupes_options where slug = p_groupe;
  if gid is null then
    return false;
  end if;
  if n = '' or length(n) > 60 then
    raise exception 'nom_invalide';
  end if;
  if exists (select 1 from options where groupe_id = gid and lower(nom) = lower(n)) then
    raise exception 'option_existe';
  end if;
  insert into options (groupe_id, nom, prix_centimes, prix_a_valider, ordre)
    values (gid, n, p_prix_centimes, not p_prix_valide, coalesce((select max(ordre) + 1 from options where groupe_id = gid), 1));
  perform journaliser(p_personnel, 'option', p_groupe || '/' || n, null,
    jsonb_build_object('nom', n, 'prix_centimes', p_prix_centimes, 'prix_a_valider', not p_prix_valide));
  return true;
end;
$$;

-- ---------- Photos ----------

-- Une photo envoyée qu'aucun plat n'affiche plus est effacée.
create function nettoyer_photos() returns void
language sql as $$
  delete from photos_plats f where not exists (select 1 from plats p where p.photo = f.id::text || '.jpg');
$$;

-- Photo déjà redimensionnée par le serveur (JPEG, en base64), posée tout de suite sur le plat.
-- Renvoie le nom de fichier affiché par le site (/photos/<id>.jpg).
create function envoyer_photo(p_slug text, p_donnees text, p_largeur integer, p_hauteur integer, p_personnel uuid) returns text
language plpgsql as $$
declare
  avant text;
  fid uuid;
  octets bytea := decode(p_donnees, 'base64');
begin
  perform gerant_nom(p_personnel);
  select photo into avant from plats where slug = p_slug for update;
  if not found then
    return null;
  end if;
  -- Signature JPEG : le serveur n'enregistre que ce qu'il a lui-même produit.
  if substring(octets from 1 for 3) <> '\xffd8ff'::bytea then
    raise exception 'photo_invalide';
  end if;
  insert into photos_plats (plat_slug, largeur, hauteur, octets, donnees, envoye_par)
    values (p_slug, p_largeur, p_hauteur, length(octets), octets, p_personnel)
    returning id into fid;
  update plats set photo = fid::text || '.jpg' where slug = p_slug;
  perform nettoyer_photos();
  perform journaliser(p_personnel, 'photo', p_slug, jsonb_build_object('photo', avant), jsonb_build_object('photo', fid::text || '.jpg'));
  return fid::text || '.jpg';
end;
$$;

create function retirer_photo(p_slug text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant text;
begin
  perform gerant_nom(p_personnel);
  select photo into avant from plats where slug = p_slug for update;
  if not found then
    return false;
  end if;
  update plats set photo = null where slug = p_slug;
  perform nettoyer_photos();
  perform journaliser(p_personnel, 'photo', p_slug, jsonb_build_object('photo', avant), jsonb_build_object('photo', null));
  return true;
end;
$$;

-- Fichier d'une photo affichée par un plat, en base64. Rien pour une photo retirée.
create function photo_plat(p_fichier text) returns text
language sql stable as $$
  select encode(f.donnees, 'base64')
  from photos_plats f
  where f.id::text || '.jpg' = p_fichier
    and exists (select 1 from plats p where p.photo = p_fichier);
$$;

-- ---------- Plat du jour ----------

-- p = { slug, nom, description, prix_centimes, station, jour (AAAA-MM-JJ), service, provenance,
--       allergenes, commandable }
-- Pour aujourd'hui ou un jour à venir (14 jours au plus). Le prix est valable dès que le gérant le
-- saisit (décision de Jérémy du 12.11.2026) ; pour le reste, même règle que les autres plats : en vente
-- seulement si rien ne le bloque (allergènes).
create function ajouter_plat_du_jour(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  j date := (p ->> 'jour')::date;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  s text;
  pid uuid;
  m text[];
  apres plats%rowtype;
begin
  perform gerant_nom(p_personnel);
  if j < aujourdhui or j > aujourdhui + 14 then
    raise exception 'jour_invalide';
  end if;
  if coalesce(p ->> 'service', '') not in ('midi', 'soir', 'journee') then
    raise exception 'service_invalide';
  end if;
  if texte_jsonb(p, 'nom', 80) is null then
    raise exception 'nom_invalide';
  end if;
  s := slug_libre(p ->> 'slug');
  insert into plats (slug, categorie_id, nom, description, prix_centimes, prix_a_valider, commandable, station,
                     ordre, provenance, allergenes, origine, jour, jour_service)
  select s, c.id, texte_jsonb(p, 'nom', 80), coalesce(texte_jsonb(p, 'description', 400), ''),
    (p ->> 'prix_centimes')::integer, false, false,
    (p ->> 'station')::station,
    coalesce((select max(x.ordre) + 1 from plats x where x.categorie_id = c.id and x.jour = j), 1),
    texte_jsonb(p, 'provenance', 300), texte_jsonb(p, 'allergenes', 300), 'jour', j, p ->> 'service'
  from categories c where c.slug = 'plat-du-jour'
  returning id into pid;
  m := motifs_plat(pid);
  if coalesce((p ->> 'commandable')::boolean, false) and cardinality(m) = 0 then
    update plats set commandable = true where id = pid;
  end if;
  select * into apres from plats where id = pid;
  perform journaliser(p_personnel, 'plat_du_jour', s, null, to_jsonb(apres) - 'id' - 'cree_le' - 'modifie_le');
  return jsonb_build_object('slug', s, 'commandable', apres.commandable, 'manques', to_jsonb(m));
end;
$$;

-- Service d'un plat du jour (midi, soir, journée) ; sa date ne change pas : on en crée un autre.
create function modifier_service_jour(p_slug text, p_service text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant text;
begin
  perform gerant_nom(p_personnel);
  if p_service not in ('midi', 'soir', 'journee') then
    raise exception 'service_invalide';
  end if;
  select jour_service into avant from plats where slug = p_slug and origine = 'jour' for update;
  if avant is null then
    return false;
  end if;
  update plats set jour_service = p_service where slug = p_slug;
  perform journaliser(p_personnel, 'plat_du_jour', p_slug, jsonb_build_object('service', avant), jsonb_build_object('service', p_service));
  return true;
end;
$$;

-- ---------- Droits ----------

revoke execute on function
  motifs_plat(uuid), verifier_plat_en_vente(), gestion_carte(), slug_libre(text), texte_jsonb(jsonb, text, integer),
  remplir_plat(uuid, jsonb), ajouter_plat(jsonb, uuid), modifier_plat(text, jsonb, uuid), archiver_plat(text, boolean, uuid),
  ordonner_plats(text, text[], uuid), ajouter_categorie(text, text, uuid), renommer_categorie(text, text, uuid),
  ordonner_categories(text[], uuid), ajouter_option(text, text, integer, boolean, uuid), nettoyer_photos(),
  envoyer_photo(text, text, integer, integer, uuid), retirer_photo(text, uuid), photo_plat(text),
  ajouter_plat_du_jour(jsonb, uuid), modifier_service_jour(text, text, uuid), plats_tablette()
  from public, anon, authenticated;
grant execute on function
  motifs_plat(uuid), verifier_plat_en_vente(), gestion_carte(), slug_libre(text), texte_jsonb(jsonb, text, integer),
  remplir_plat(uuid, jsonb), ajouter_plat(jsonb, uuid), modifier_plat(text, jsonb, uuid), archiver_plat(text, boolean, uuid),
  ordonner_plats(text, text[], uuid), ajouter_categorie(text, text, uuid), renommer_categorie(text, text, uuid),
  ordonner_categories(text[], uuid), ajouter_option(text, text, integer, boolean, uuid), nettoyer_photos(),
  envoyer_photo(text, text, integer, integer, uuid), retirer_photo(text, uuid), photo_plat(text),
  ajouter_plat_du_jour(jsonb, uuid), modifier_service_jour(text, text, uuid), plats_tablette()
  to service_role;
grant select, insert, update, delete on photos_plats to service_role;

-- ---------- Noms harmonisés (validés par Jérémy le 12.11.2026, docs/audits/noms-a-harmoniser.md) ----------

-- Seul le nom affiché change : slugs, commandes passées, photos et import du tableau (qui retrouve aussi
-- un plat par son slug) restent liés. Un nom déjà changé au back-office n'est pas touché (WHERE sur l'ancien nom).
update plats set nom = 'Pizza Miss Italia' where slug = 'pizza-miss-italia' and nom = 'Pizza miss Italia';
update plats set nom = 'Pizza Prosciutto' where slug = 'pizza-prosciutto' and nom = 'Pizza prosciutto';
update plats set nom = 'Pizza Tonno' where slug = 'pizza-tonno' and nom = 'Pizza tonno';
update plats set nom = 'Pizza Peppino' where slug = 'pizza-peppino' and nom = 'Pizza peppino';
update plats set nom = 'Pizza Végétarienne' where slug = 'pizza-vegetarienne' and nom = 'Pizza végétarienne';
update plats set nom = 'Pizza Rucola' where slug = 'pizza-rucola' and nom = 'Pizza rucola';
update plats set nom = 'Pizza Melanzana' where slug = 'pizza-melanzana' and nom = 'Pizza melanzana';
update plats set nom = 'Pizza Norvégienne' where slug = 'pizza-norvegienne' and nom = 'Pizza norvégienne';
update plats set nom = 'Pizza Bresaola' where slug = 'pizza-bresaola' and nom = 'Pizza bresaola';
update plats set nom = 'Pizza Funghi' where slug = 'pizza-funghi' and nom = 'Pizza funghi';
update plats set nom = 'Pizza Stromboli' where slug = 'pizza-stromboli' and nom = 'Pizza stromboli';
update plats set nom = 'Risotto noix de Saint-Jacques' where slug = 'risotto-noix-de-saint-jacques' and nom = 'Risotto noix de Saint Jacques';
update plats set nom = 'Pasta al pomodoro e basilico' where slug = 'pasta-al-pomodoro-et-basilico' and nom = 'Pasta al pomodoro et basilico';
update plats set nom = 'Rigatoni alla parmigiana e Burrata' where slug = 'rigatoni-alla-parmigiana-et-burrata' and nom = 'Rigatoni alla parmigiana et Burrata';
update plats set nom = 'Paccheri alla salsiccia siciliana e polpette de bœuf' where slug = 'paccheri-alla-salsiccia-siciliana-et-polpette-de-boeuf' and nom = 'Paccheri alla salsiccia siciliana et polpette de bœuf';
