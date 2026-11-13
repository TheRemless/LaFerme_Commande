-- Vague 3, client-commande : offre de bienvenue A retenue par Jérémy (13.11.2026), 10 % sur le total des plats de
-- la première commande (docs/lancement/offre-premiere-commande.md). Préparée ÉTEINTE : le code est inactif et
-- l'interrupteur général codes_promo_actifs reste tel quel. Dates, plafond et codes par support (flyer, fiche
-- Google) se règlent au back-office (rubrique Codes promo) quand Jérémy donne le feu vert.
insert into codes_promo (code, libelle, type, valeur, premiere_commande, une_fois_par_client, actif)
values ('BIENVENUE', 'Offre de bienvenue, 10 % sur la première commande', 'pourcentage', 10, true, true, false)
on conflict (code) do nothing;
