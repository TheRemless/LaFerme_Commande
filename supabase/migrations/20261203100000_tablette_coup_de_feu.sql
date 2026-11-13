-- Coup de feu depuis la tablette (vague 3, tablette) : la route /api/tablette/coup-de-feu ouvre le geste au gérant,
-- et à l'équipe de service seulement si ce réglage est vrai. Construit désactivé (consigne du chef : décision de
-- Jérémy). Pour l'ouvrir à l'équipe :
--   update reglages set valeur = 'true', proposition = false where cle = 'coup_de_feu_par_equipe';
-- Aucune fonction recréée : lancer_coup_de_feu et finir_coup_de_feu (20261130090000, bo-operations) restent
-- telles quelles et revérifient l'équipe (service ou gérant, actif).
insert into reglages (cle, valeur, proposition) values ('coup_de_feu_par_equipe', 'false', true)
  on conflict (cle) do nothing;
