-- Zones de livraison, horaires, fermetures et réglages du service (docs/PROMPT.md §6).
-- Les valeurs de départ sont des propositions : colonne proposition = true jusqu'à validation par Jérémy.

create table zones_livraison (
  numero smallint primary key,
  nom text not null,
  frais_centimes integer not null check (frais_centimes >= 0),
  minimum_centimes integer not null check (minimum_centimes >= 0),
  -- Délai annoncé au client, préparation comprise, en minutes.
  delai_min smallint not null,
  delai_max smallint not null check (delai_max >= delai_min),
  active boolean not null default false,
  proposition boolean not null default true
);

create table zone_npa (
  npa text not null check (npa ~ '^[0-9]{4}$'),
  localite text not null,
  zone_numero smallint not null references zones_livraison (numero) on delete cascade,
  primary key (npa, localite)
);
create index zone_npa_npa_idx on zone_npa (npa);

-- Jours ISO : 1 = lundi … 7 = dimanche. Heures locales de Genève.
create table horaires (
  id smallint generated always as identity primary key,
  jour smallint not null check (jour between 1 and 7),
  service text not null check (service in ('midi', 'soir')),
  -- Première et dernière heure de livraison ou de retrait.
  premiere_heure time not null,
  derniere_heure time not null,
  -- Dernière commande pour la carte complète, puis pour les pizzas seules.
  derniere_commande time not null,
  derniere_commande_pizzas time not null,
  proposition boolean not null default true,
  unique (jour, service),
  check (premiere_heure < derniere_heure and derniere_commande <= derniere_commande_pizzas)
);

create table fermetures (
  id smallint generated always as identity primary key,
  debut date not null,
  fin date not null check (fin >= debut),
  motif text not null
);

create table reglages (
  cle text primary key,
  valeur jsonb not null,
  proposition boolean not null default true
);

alter table zones_livraison enable row level security;
alter table zone_npa enable row level security;
alter table horaires enable row level security;
alter table fermetures enable row level security;
alter table reglages enable row level security;

-- Tout ceci s'affiche aux visiteurs avant la carte : lecture publique, écriture réservée.
create policy "lecture publique" on zones_livraison for select to anon, authenticated using (true);
create policy "lecture publique" on zone_npa for select to anon, authenticated using (true);
create policy "lecture publique" on horaires for select to anon, authenticated using (true);
create policy "lecture publique" on fermetures for select to anon, authenticated using (true);
create policy "lecture publique" on reglages for select to anon, authenticated using (true);

grant select on zones_livraison, zone_npa, horaires, fermetures, reglages to anon, authenticated;

-- Valeurs proposées le 5.11.2026 (docs/recherche/propositions-livraison-horaires.md §5).
insert into zones_livraison (numero, nom, frais_centimes, minimum_centimes, delai_min, delai_max, active) values
  (1, 'Zone 1', 290, 3000, 30, 40, true),
  (2, 'Zone 2', 490, 4000, 40, 50, true),
  (3, 'Zone 3', 790, 6000, 50, 65, false);

insert into zone_npa (npa, localite, zone_numero) values
  ('1213', 'Onex', 1),
  ('1213', 'Petit-Lancy', 1),
  ('1212', 'Grand-Lancy', 1),
  ('1232', 'Confignon', 1),
  ('1233', 'Bernex', 1),
  ('1205', 'Genève', 2),
  ('1227', 'Carouge GE', 2),
  ('1227', 'Les Acacias', 2),
  ('1228', 'Plan-les-Ouates', 2),
  ('1219', 'Le Lignon', 2),
  ('1219', 'Aïre', 2),
  ('1201', 'Genève', 3),
  ('1202', 'Genève', 3),
  ('1204', 'Genève', 3),
  ('1206', 'Genève', 3),
  ('1207', 'Genève', 3),
  ('1214', 'Vernier', 3),
  ('1258', 'Perly', 3),
  ('1236', 'Cartigny', 3);

insert into horaires (jour, service, premiere_heure, derniere_heure, derniere_commande, derniere_commande_pizzas)
select j, 'midi', time '11:45', time '13:45', time '13:15', time '13:15' from generate_series(2, 6) as j
union all
select j, 'soir', time '18:45', time '22:45', time '21:30', time '22:15' from generate_series(2, 6) as j;

-- Confirmée par Jérémy le 27.10.2026 (registre de faits) : ce n'est pas une proposition.
insert into fermetures (debut, fin, motif) values ('2026-12-22', '2027-01-11', 'Fermeture annuelle');

insert into reglages (cle, valeur) values
  ('preparation_minutes', '20'),
  ('creneau_minutes', '15'),
  ('avance_jours', '7'),
  ('capacite_livraisons_par_creneau', '3'),
  ('capacite_retraits_par_creneau', '4');
