-- Carte du site de commande : catégories, plats, options, retraits.
-- Les prix sont en centimes et ne vivent que dans la base (docs/PROMPT.md §5.7).

create type station as enum ('pizza', 'cuisine');

create table categories (
  id smallint generated always as identity primary key,
  slug text not null unique,
  nom text not null,
  ordre smallint not null
);

create table plats (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  categorie_id smallint not null references categories (id),
  nom text not null,
  description text not null default '',
  prix_centimes integer not null check (prix_centimes >= 0),
  -- Vrai tant que Jérémy n'a pas validé le prix dans docs/validation-carte.xlsx.
  prix_a_valider boolean not null default true,
  commandable boolean not null default true,
  station station not null,
  photo text,
  ordre smallint not null default 0,
  -- Rempli quand le plat est épuisé : la raison est affichée au client.
  rupture_motif text,
  -- Texte affiché sur la fiche, par exemple « Bœuf : Suisse ou Autriche ».
  provenance text,
  provenances_a_fournir text[] not null default '{}',
  -- Vide tant que le restaurant n'a pas fourni la liste : la fiche renvoie au téléphone.
  allergenes text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index plats_categorie_idx on plats (categorie_id, ordre);

create table groupes_options (
  id smallint generated always as identity primary key,
  slug text not null unique,
  nom text not null,
  choix_min smallint not null default 0,
  choix_max smallint not null,
  check (choix_min >= 0 and choix_max >= choix_min)
);

create table options (
  id uuid primary key default gen_random_uuid(),
  groupe_id smallint not null references groupes_options (id) on delete cascade,
  nom text not null,
  prix_centimes integer not null default 0 check (prix_centimes >= 0),
  prix_a_valider boolean not null default true,
  actif boolean not null default true,
  ordre smallint not null default 0,
  modifie_le timestamptz not null default now(),
  unique (groupe_id, nom)
);

create table plat_groupes (
  plat_id uuid not null references plats (id) on delete cascade,
  groupe_id smallint not null references groupes_options (id) on delete cascade,
  ordre smallint not null default 0,
  primary key (plat_id, groupe_id)
);

-- Ingrédients qu'on peut retirer gratuitement, tirés de la description.
create table plat_retraits (
  id uuid primary key default gen_random_uuid(),
  plat_id uuid not null references plats (id) on delete cascade,
  nom text not null,
  a_valider boolean not null default true,
  ordre smallint not null default 0,
  modifie_le timestamptz not null default now(),
  unique (plat_id, nom)
);

create function maj_modifie_le() returns trigger
language plpgsql as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;
create trigger plats_modifie_le before update on plats
  for each row execute function maj_modifie_le();
create trigger options_modifie_le before update on options
  for each row execute function maj_modifie_le();
create trigger plat_retraits_modifie_le before update on plat_retraits
  for each row execute function maj_modifie_le();

-- Sécurité : lecture publique de la carte commandable, aucune écriture sans la clé de service.
alter table categories enable row level security;
alter table plats enable row level security;
alter table groupes_options enable row level security;
alter table options enable row level security;
alter table plat_groupes enable row level security;
alter table plat_retraits enable row level security;

create policy "lecture publique" on categories for select to anon, authenticated using (true);
create policy "plats commandables" on plats for select to anon, authenticated using (commandable);
create policy "lecture publique" on groupes_options for select to anon, authenticated using (true);
create policy "options actives" on options for select to anon, authenticated using (actif);
create policy "groupes des plats commandables" on plat_groupes for select to anon, authenticated
  using (exists (select 1 from plats p where p.id = plat_id and p.commandable));
create policy "retraits des plats commandables" on plat_retraits for select to anon, authenticated
  using (exists (select 1 from plats p where p.id = plat_id and p.commandable));

-- Carte telle que le site l'affiche. security_invoker : la vue applique les règles du lecteur.
create view carte_publique with (security_invoker = true) as
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
  p.rupture_motif,
  p.provenance,
  p.provenances_a_fournir,
  p.allergenes,
  exists (select 1 from plat_groupes g where g.plat_id = p.id)
    or exists (select 1 from plat_retraits r where r.plat_id = p.id) as a_options
from plats p
join categories c on c.id = p.categorie_id;

-- Ce qui bloque la mise en production (docs/PROMPT.md §5.2 et §5.5). Réservé à la clé de service.
create view plats_bloquants with (security_invoker = true) as
select p.slug, p.nom, 'prix à valider' as motif
from plats p where p.commandable and p.prix_a_valider
union all
select p.slug, p.nom, 'allergènes manquants'
from plats p where p.commandable and coalesce(p.allergenes, '') = ''
union all
select p.slug, p.nom, 'provenance à fournir'
from plats p where p.commandable and cardinality(p.provenances_a_fournir) > 0
union all
select distinct p.slug, p.nom, 'supplément à valider : ' || o.nom
from plats p
join plat_groupes g on g.plat_id = p.id
join options o on o.groupe_id = g.groupe_id and o.actif and o.prix_a_valider
where p.commandable
union all
select distinct p.slug, p.nom, 'retraits à valider'
from plats p
join plat_retraits r on r.plat_id = p.id and r.a_valider
where p.commandable;

revoke all on plats_bloquants from anon, authenticated;
grant select on carte_publique to anon, authenticated;
