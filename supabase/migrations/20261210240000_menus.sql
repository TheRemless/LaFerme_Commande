-- Menus et formules (vague 3, bo-carte) : construits complets mais DÉSACTIVÉS. Vendre des menus est une
-- décision de Jérémy (question posée par produit-gestion) : le réglage menus_actifs est faux, chaque menu
-- naît inactif et son prix à valider. Aucun prix ici : le gérant saisit tout.
--
-- Un menu : nom, description, prix fixe ; des étapes (« Une pizza au choix », « Un dessert », « Une
-- boisson ») ; chaque étape propose une catégorie entière ou une liste de plats, avec un supplément
-- possible par plat (« Pizza Burrata : + CHF 3 »). prix_menu vérifie un choix et en donne le prix, pour le
-- panier et le paiement (branchement : client-commande, plus tard).
--
-- Objets partagés recréés : aucun. Tables et fonctions neuves, un réglage neuf.

create table menus (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  nom text not null check (length(nom) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  prix_centimes integer not null check (prix_centimes > 0),
  prix_a_valider boolean not null default true,
  actif boolean not null default false,
  ordre smallint not null default 0,
  archive_le timestamptz,
  cree_le timestamptz not null default now(),
  check (archive_le is null or not actif)
);

create table menu_etapes (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus (id) on delete cascade,
  ordre smallint not null,
  nom text not null check (length(nom) between 1 and 60),
  choix_min smallint not null default 1,
  choix_max smallint not null default 1,
  -- Toute une catégorie (null : seulement les plats listés dans menu_etape_plats).
  categorie_id smallint references categories (id),
  check (choix_min >= 0 and choix_max >= 1 and choix_min <= choix_max and choix_max <= 10),
  unique (menu_id, ordre)
);

-- Plats d'une étape et leur supplément (0 par défaut). Avec une catégorie entière, une ligne ici ne sert
-- qu'à donner un supplément à un plat de cette catégorie.
create table menu_etape_plats (
  etape_id uuid not null references menu_etapes (id) on delete cascade,
  plat_id uuid not null references plats (id) on delete cascade,
  supplement_centimes integer not null default 0 check (supplement_centimes >= 0),
  primary key (etape_id, plat_id)
);

alter table menus enable row level security;
alter table menu_etapes enable row level security;
alter table menu_etape_plats enable row level security;
revoke all on menus, menu_etapes, menu_etape_plats from anon, authenticated;
grant select, insert, update, delete on menus, menu_etapes, menu_etape_plats to service_role;

insert into reglages (cle, valeur, proposition) values ('menus_actifs', 'false'::jsonb, true) on conflict (cle) do nothing;

-- ---------- Ce qui manque pour vendre un menu ----------

-- Motifs qui empêchent de mettre un menu en vente : prix à valider, aucune étape, étape sans plat.
create function motifs_menu(p_id uuid) returns text[]
language sql stable as $$
  select array_remove(array[
    case when m.prix_a_valider then 'prix à valider' end,
    case when not exists (select 1 from menu_etapes e where e.menu_id = m.id) then 'aucune étape' end,
    case when exists (
      select 1 from menu_etapes e where e.menu_id = m.id and e.categorie_id is null
        and not exists (select 1 from menu_etape_plats ep where ep.etape_id = e.id)
    ) then 'étape sans plat' end
  ], null)
  from menus m where m.id = p_id;
$$;

-- ---------- Back-office ----------

-- p : { nom, description, prix_centimes, prix_valide }. Slug proposé par le serveur, suffixé s'il est pris.
-- Un menu naît inactif.
create function creer_menu(p_slug text, p jsonb, p_personnel uuid) returns text
language plpgsql as $$
declare
  s text := p_slug;
  i integer := 1;
  m menus%rowtype;
begin
  perform gerant_nom(p_personnel);
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,56}$' then
    raise exception 'slug_invalide';
  end if;
  while exists (select 1 from menus where slug = s) loop
    i := i + 1;
    s := p_slug || '-' || i;
  end loop;
  insert into menus (slug, nom, description, prix_centimes, prix_a_valider, ordre)
  values (s, btrim(p ->> 'nom'), coalesce(btrim(p ->> 'description'), ''), (p ->> 'prix_centimes')::integer,
          not coalesce((p ->> 'prix_valide')::boolean, false), coalesce((select max(ordre) + 1 from menus), 1))
  returning * into m;
  perform journaliser(p_personnel, 'menu', s, null, to_jsonb(m) - 'id' - 'cree_le');
  return s;
end;
$$;

-- Champs facultatifs : nom, description, prix_centimes, prix_valide, actif. Un prix changé sans prix_valide
-- repart à valider. Activer exige que rien ne manque (motifs_menu).
create function modifier_menu(p_slug text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant menus%rowtype;
  apres menus%rowtype;
  m text[];
begin
  perform gerant_nom(p_personnel);
  select * into avant from menus where slug = p_slug for update;
  if not found then
    return false;
  end if;
  if avant.archive_le is not null then
    raise exception 'menu_archive';
  end if;
  update menus set
    nom = coalesce(btrim(p ->> 'nom'), nom),
    description = coalesce(btrim(p ->> 'description'), description),
    prix_centimes = coalesce((p ->> 'prix_centimes')::integer, prix_centimes),
    prix_a_valider = case
      when p ? 'prix_valide' then not (p ->> 'prix_valide')::boolean
      when p ? 'prix_centimes' and (p ->> 'prix_centimes')::integer <> avant.prix_centimes then true
      else prix_a_valider end,
    actif = coalesce((p ->> 'actif')::boolean, actif)
  where id = avant.id
  returning * into apres;
  if apres.actif then
    m := motifs_menu(apres.id);
    if cardinality(m) > 0 then
      raise exception 'menu_incomplet: %', array_to_string(m, ', ');
    end if;
  end if;
  perform journaliser(p_personnel, 'menu', p_slug, to_jsonb(avant) - 'id' - 'cree_le', to_jsonb(apres) - 'id' - 'cree_le');
  return true;
end;
$$;

-- Étapes d'un menu (liste complète, dans l'ordre) :
-- [{ nom, choix_min, choix_max, categorie (slug ou null), plats: [{ slug, supplement_centimes }] }].
-- Six étapes au plus. Un menu actif reste complet (sinon refusé).
create function regler_etapes(p_slug text, p_etapes jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  mid uuid;
  actif boolean;
  avant jsonb;
  e jsonb;
  n integer := 0;
  eid uuid;
  cid smallint;
  pl jsonb;
  pid uuid;
  m text[];
begin
  perform gerant_nom(p_personnel);
  select id, menus.actif into mid, actif from menus where slug = p_slug and archive_le is null for update;
  if mid is null then
    return false;
  end if;
  if jsonb_typeof(p_etapes) <> 'array' or jsonb_array_length(p_etapes) > 6 then
    raise exception 'etapes_invalides';
  end if;
  avant := menus_etapes_json(mid);
  delete from menu_etapes where menu_id = mid;
  for e in select * from jsonb_array_elements(p_etapes) loop
    n := n + 1;
    cid := null;
    if coalesce(e ->> 'categorie', '') <> '' then
      select id into cid from categories where slug = e ->> 'categorie' and slug <> 'plat-du-jour';
      if cid is null then
        raise exception 'categorie_inconnue';
      end if;
    end if;
    insert into menu_etapes (menu_id, ordre, nom, choix_min, choix_max, categorie_id)
    values (mid, n, btrim(e ->> 'nom'), coalesce((e ->> 'choix_min')::smallint, 1), coalesce((e ->> 'choix_max')::smallint, 1), cid)
    returning id into eid;
    for pl in select * from jsonb_array_elements(coalesce(e -> 'plats', '[]'::jsonb)) loop
      select id into pid from plats where slug = pl ->> 'slug' and archive_le is null;
      if pid is null then
        raise exception 'plat_inconnu';
      end if;
      insert into menu_etape_plats (etape_id, plat_id, supplement_centimes)
      values (eid, pid, coalesce((pl ->> 'supplement_centimes')::integer, 0))
      on conflict (etape_id, plat_id) do update set supplement_centimes = excluded.supplement_centimes;
    end loop;
  end loop;
  if actif then
    m := motifs_menu(mid);
    if cardinality(m) > 0 then
      raise exception 'menu_incomplet: %', array_to_string(m, ', ');
    end if;
  end if;
  perform journaliser(p_personnel, 'menu_etapes', p_slug, jsonb_build_object('etapes', avant), jsonb_build_object('etapes', menus_etapes_json(mid)));
  return true;
end;
$$;

-- Archiver (hors de la vente, gardé pour les commandes passées) ou remettre (inactif).
create function archiver_menu(p_slug text, p_archiver boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant menus%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from menus where slug = p_slug for update;
  if not found then
    return false;
  end if;
  update menus set archive_le = case when p_archiver then coalesce(archive_le, now()) end, actif = false where id = avant.id;
  perform journaliser(p_personnel, 'menu_archive', p_slug, jsonb_build_object('archive', avant.archive_le is not null), jsonb_build_object('archive', p_archiver));
  return true;
end;
$$;

-- Interrupteur général (réglage menus_actifs), journalisé.
create function activer_menus(p_actif boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select valeur into avant from reglages where cle = 'menus_actifs' for update;
  update reglages set valeur = to_jsonb(p_actif), proposition = false where cle = 'menus_actifs';
  perform journaliser(p_personnel, 'menus', 'menus_actifs', jsonb_build_object('actif', avant), jsonb_build_object('actif', p_actif));
  return true;
end;
$$;

-- ---------- Lecture ----------
-- Étapes d'un menu, dans l'ordre : [{ nom, choix_min, choix_max, categorie, plats: [{ slug, nom, supplement_centimes }] }].
create function menus_etapes_json(p_menu uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'nom', e.nom, 'choix_min', e.choix_min, 'choix_max', e.choix_max,
    'categorie', (select c.slug from categories c where c.id = e.categorie_id),
    'plats', coalesce((
      select jsonb_agg(jsonb_build_object('slug', p.slug, 'nom', p.nom, 'supplement_centimes', ep.supplement_centimes) order by p.nom)
      from menu_etape_plats ep join plats p on p.id = ep.plat_id where ep.etape_id = e.id
    ), '[]'::jsonb)
  ) order by e.ordre), '[]'::jsonb)
  from menu_etapes e where e.menu_id = p_menu;
$$;

-- Back-office : l'interrupteur et tous les menus, archivés compris, avec ce qui manque.
create function menus_gestion() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'actifs', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'menus_actifs'), false),
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', m.slug, 'nom', m.nom, 'description', m.description, 'prix_centimes', m.prix_centimes,
        'prix_a_valider', m.prix_a_valider, 'actif', m.actif, 'archive', m.archive_le is not null,
        'etapes', menus_etapes_json(m.id), 'manques', to_jsonb(motifs_menu(m.id))
      ) order by m.archive_le nulls first, m.ordre, m.nom)
      from menus m
    ), '[]'::jsonb)
  );
$$;

-- Menus en vente (serveur, pour la carte quand le branchement sera fait) : rien tant que l'interrupteur
-- est faux ; sinon les menus actifs, au prix validé, non archivés.
create function menus_publics() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', m.slug, 'nom', m.nom, 'description', m.description, 'prix_centimes', m.prix_centimes, 'etapes', menus_etapes_json(m.id)
  ) order by m.ordre, m.nom), '[]'::jsonb)
  from menus m
  where coalesce((select valeur = 'true'::jsonb from reglages where cle = 'menus_actifs'), false)
    and m.actif and not m.prix_a_valider and m.archive_le is null;
$$;

-- Vérifie un choix de menu et en donne le prix (prix du menu + suppléments des plats choisis), pour le
-- panier et le paiement. p_choix : un tableau par étape, dans l'ordre, des slugs choisis.
-- Rend { ok: true, prix_centimes, choix: [{ etape, slug, nom, supplement_centimes }] } ou { ok: false, raison, etape? }.
-- raison : desactive, inconnu, choix_invalides, nombre, pas_propose, epuise.
create function prix_menu(p_slug text, p_choix jsonb) returns jsonb
language plpgsql stable as $$
declare
  m menus%rowtype;
  e record;
  i integer := 0;
  choisis jsonb;
  s text;
  pl record;
  total integer;
  lignes jsonb := '[]'::jsonb;
begin
  if not coalesce((select valeur = 'true'::jsonb from reglages where cle = 'menus_actifs'), false) then
    return jsonb_build_object('ok', false, 'raison', 'desactive');
  end if;
  select * into m from menus where slug = p_slug and actif and not prix_a_valider and archive_le is null;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'inconnu');
  end if;
  if jsonb_typeof(p_choix) <> 'array' or jsonb_array_length(p_choix) <> (select count(*) from menu_etapes where menu_id = m.id) then
    return jsonb_build_object('ok', false, 'raison', 'choix_invalides');
  end if;
  total := m.prix_centimes;
  for e in select * from menu_etapes where menu_id = m.id order by ordre loop
    choisis := p_choix -> i;
    i := i + 1;
    if jsonb_typeof(choisis) <> 'array' or jsonb_array_length(choisis) < e.choix_min or jsonb_array_length(choisis) > e.choix_max then
      return jsonb_build_object('ok', false, 'raison', 'nombre', 'etape', e.nom);
    end if;
    for s in select jsonb_array_elements_text(choisis) loop
      select p.id, p.slug, p.nom, coalesce(ep.supplement_centimes, 0) as supplement, cp.rupture_motif, cp.rupture_jusqu_au, p.commandable
        into pl
      from plats p
      left join menu_etape_plats ep on ep.etape_id = e.id and ep.plat_id = p.id
      left join carte_publique cp on cp.slug = p.slug
      where p.slug = s and p.archive_le is null
        and (ep.plat_id is not null or (e.categorie_id is not null and p.categorie_id = e.categorie_id));
      if pl.id is null then
        return jsonb_build_object('ok', false, 'raison', 'pas_propose', 'etape', e.nom);
      end if;
      if not pl.commandable or pl.rupture_motif is not null or pl.rupture_jusqu_au is not null then
        return jsonb_build_object('ok', false, 'raison', 'epuise', 'etape', e.nom, 'plat', pl.nom);
      end if;
      total := total + pl.supplement;
      lignes := lignes || jsonb_build_array(jsonb_build_object('etape', e.nom, 'slug', pl.slug, 'nom', pl.nom, 'supplement_centimes', pl.supplement));
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'prix_centimes', total, 'choix', lignes);
end;
$$;

-- ---------- Droits ----------

revoke execute on function
  motifs_menu(uuid), creer_menu(text, jsonb, uuid), modifier_menu(text, jsonb, uuid), regler_etapes(text, jsonb, uuid),
  archiver_menu(text, boolean, uuid), activer_menus(boolean, uuid), menus_etapes_json(uuid), menus_gestion(),
  menus_publics(), prix_menu(text, jsonb)
  from public, anon, authenticated;
grant execute on function
  motifs_menu(uuid), creer_menu(text, jsonb, uuid), modifier_menu(text, jsonb, uuid), regler_etapes(text, jsonb, uuid),
  archiver_menu(text, boolean, uuid), activer_menus(boolean, uuid), menus_etapes_json(uuid), menus_gestion(),
  menus_publics(), prix_menu(text, jsonb)
  to service_role;
