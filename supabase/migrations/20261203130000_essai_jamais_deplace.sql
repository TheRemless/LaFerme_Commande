-- Ticket de test jamais déplacé (relevé par bo-operations après la #171) : modifier_imprimante (20261113090000)
-- renvoie les tâches d'une imprimante désactivée vers une autre imprimante active du poste, ou en sans_imprimante.
-- Pour un essai, c'est trompeur : « TEST Cuisine 1… Si ce ticket sort, l'imprimante est bien branchée » sortirait sur
-- Cuisine 2. Un essai qui change d'imprimante (désactivation, imprimante supprimée) est annulé à sa place.
-- Aucune fonction partagée recréée : un déclencheur sur taches_impression. reprendre_sans_imprimante ignore déjà les
-- essais (elle joint commandes).

create function essai_jamais_deplace() returns trigger
language plpgsql as $$
begin
  -- L'imprimante n'est pas remise : une imprimante supprimée passe par « on delete set null ». Une tâche annulée
  -- n'est jamais envoyée (passage_imprimante ne prend que les tâches en attente).
  new.etat := 'annulee';
  return new;
end;
$$;
create trigger essai_jamais_deplace before update of imprimante_id on taches_impression
  for each row when (old.essai and new.imprimante_id is distinct from old.imprimante_id and old.etat in ('en_attente', 'envoyee'))
  execute function essai_jamais_deplace();

revoke all on function essai_jamais_deplace() from public, anon, authenticated;
