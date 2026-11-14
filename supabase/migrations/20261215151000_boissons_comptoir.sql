-- Poste « comptoir », suite de 20261215150000 (vague 3, bo-carte).
--
-- 1. Les boissons passent au comptoir. Les desserts restent où ils sont : certains se préparent peut-être au four,
--    Jérémy choisit plat par plat au back-office (Carte, fiche du plat, « Poste »). Les commandes déjà passées gardent
--    le poste figé sur leurs lignes.
-- 2. commande_postes_aux_tickets() (tablette, 20261203120000) recréée avec un seul changement : une ligne au comptoir
--    n'ouvre pas de poste. Le comptoir n'a ni ticket de préparation, ni temps de poste, ni file. Sans ce filtre, une
--    ligne « comptoir » resterait ouverte jusqu'au statut « prête » et fausserait les temps du pilotage.
--
-- La charge (charge_cuisine, 20261130220000) ne compte déjà que 'pizza' et 'cuisine' : un article au comptoir ne
-- compte dans aucun débit, sans changement (tests/unit/poste-comptoir.test.ts le vérifie).

update plats set station = 'comptoir', modifie_le = now()
  where categorie_id = (select id from categories where slug = 'boissons') and station <> 'comptoir';

create or replace function commande_postes_aux_tickets() returns trigger
language plpgsql as $$
begin
  insert into commande_postes (commande_id, station, a_faire_le)
    select distinct new.id, l.station, new.tickets_le from commande_lignes l
    where l.commande_id = new.id and l.station <> 'comptoir'
    on conflict (commande_id, station) do nothing;
  return null;
end;
$$;
