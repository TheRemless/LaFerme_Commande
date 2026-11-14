-- Poste « comptoir » (vague 3, bo-carte, décision de Jérémy du 14.11.2026) : l'équipe du comptoir met boissons et
-- desserts prêts dans le sac. Un article au comptoir n'a pas de ticket de préparation, ne compte dans aucun débit
-- (four ou cuisine) et n'ouvre pas de ligne dans commande_postes. Il apparaît seulement sur le ticket du sac et sur
-- l'écran comptoir de la tablette.
--
-- Seule la valeur s'ajoute ici : Postgres refuse d'utiliser une valeur d'enum dans la transaction qui l'a créée.
-- Les boissons passent au comptoir dans la migration suivante (20261215151000).
alter type station add value if not exists 'comptoir';
