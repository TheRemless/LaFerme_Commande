-- Lot 4 : ce qu'il faut pour la fiche plat et le calcul du panier.

-- La station sert à la règle des pizzas : un panier 100 % poste pizza se commande plus tard le soir.
-- create or replace view n'accepte qu'un ajout de colonnes en fin de liste.
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
  p.rupture_motif,
  p.provenance,
  p.provenances_a_fournir,
  p.allergenes,
  exists (select 1 from plat_groupes g where g.plat_id = p.id)
    or exists (select 1 from plat_retraits r where r.plat_id = p.id) as a_options,
  p.station
from plats p
join categories c on c.id = p.categorie_id;

-- Groupes d'options de chaque plat commandable, par slug (les identifiants internes restent en base).
create view plat_groupes_publics with (security_invoker = true) as
select p.slug as plat_slug, g.slug as groupe_slug, pg.ordre
from plat_groupes pg
join plats p on p.id = pg.plat_id
join groupes_options g on g.id = pg.groupe_id;

create view options_publiques with (security_invoker = true) as
select g.slug as groupe_slug, g.nom as groupe_nom, g.choix_min, g.choix_max,
       o.nom, o.prix_centimes, o.prix_a_valider, o.ordre
from options o
join groupes_options g on g.id = o.groupe_id;

create view retraits_publics with (security_invoker = true) as
select p.slug as plat_slug, r.nom, r.a_valider, r.ordre
from plat_retraits r
join plats p on p.id = r.plat_id;

grant select on carte_publique, plat_groupes_publics, options_publiques, retraits_publics to anon, authenticated;

-- TVA de la vente à l'emporter et de la livraison (docs/recherche/obligations_legales.md §2).
-- Proposition : à confirmer avec la fiduciaire.
insert into reglages (cle, valeur) values ('tva_emporter_pourcent', '2.6');
