-- L'équipe de la tablette comprend le responsable de service (rôle de bo-socle, décision D1,
-- 20261210230000_droits_responsable.sql). Côté serveur, ROLES_TABLETTE l'admet déjà à tous les gestes de la
-- tablette ; en base, equipe_nom le refusait : un responsable ne pouvait ni lancer un coup de feu, ni fermer
-- une zone pour quelques heures, ni noter l'absence d'un livreur, ni suivre une réclamation.
--
-- Objet partagé recréé : equipe_nom (bo-operations, 20261130090000_coup_de_feu.sql), utilisé aussi par
-- 20261127130000_reclamations.sql (bo-commandes). Seul changement : « responsable » admis. Un responsable
-- n'existe que si role_responsable_actif est vrai (contrainte de bo-socle) ; le droit suit donc ce réglage.
-- Compatible avant et après : avant, le responsable est refusé comme aujourd'hui ; après, admis.
create or replace function equipe_nom(p_personnel uuid) returns text
language plpgsql stable as $$
declare
  n text;
begin
  select nom into n from personnel where id = p_personnel and actif and role in ('service', 'gerant', 'responsable');
  if n is null then
    raise exception 'Réservé à l''équipe du restaurant';
  end if;
  return n;
end;
$$;
