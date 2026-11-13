-- Mise en situation de produit-gestion, manques de bo-operations (vague 3, 13.11.2026). Aucune fonction partagée
-- recréée ; seulement des lignes de réglages, toutes avec un WHERE.
--
-- M3 : connexion des livreurs par code (20261203150000_code_livreur.sql, tablette). Jérémy l'a voulue ouverte au
-- lancement ; le chef a posé le réglage à vrai en production le 13.11.2026. Ici, seulement la case de Réglages
-- généraux (table interrupteurs_gestion, 20261130190000), bloc « Équipe ». La valeur du réglage n'est pas touchée.
insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('connexion_livreur_par_code', 'Connexion des livreurs par un code affiché sur la tablette',
    'Le gérant ou le responsable touche « Code de connexion » à côté du livreur (onglet Livraisons) : 8 chiffres, valables 10 minutes, à taper sur le téléphone du livreur. Jérémy la veut ouverte au lancement.',
    'aucun', 70)
  on conflict (cle) do nothing;

-- M6 : débit du four donné par Jérémy le 13.11.2026 (« 5 pizzas au four, environ 3 minutes + 2 minutes de cuisson »),
-- 15 pizzas par quart d'heure. Déjà posé en production par le chef : seulement là où il vaut encore 0.
update reglages set valeur = '15'::jsonb, proposition = false
  where cle = 'debit_pizza_quart_heure' and valeur = '0'::jsonb;
