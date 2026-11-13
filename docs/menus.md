# Menus et formules (vague 3, bo-carte)

Construits complets mais **désactivés**. Vendre des menus est une décision de Jérémy (question posée par `produit-gestion`, recommandation : pas au lancement). Aucun prix n'est écrit dans le code ni dans la base : le gérant les saisit.

Migration `supabase/migrations/20261210240000_menus.sql`. Tests : `tests/unit/menus-sql.test.ts` (base), `tests/unit/gestion-menus.test.ts` (saisie). Serveur : `/api/gestion/menus` (gérant). Écran : à venir dans la rubrique Carte et offre.

## Ce qui existe

- **Interrupteur général** : réglage `menus_actifs`, faux. Tant qu'il l'est, `menus_publics()` ne rend rien et `prix_menu` refuse tout.
- **Un menu** : nom, description, prix fixe, « Prix validé ». Il naît inactif ; il ne s'active que si rien ne manque (`motifs_menu` : prix à valider, aucune étape, étape sans plat). Un prix changé sans « Prix validé » repart à valider. Archiver le retire de la vente sans le supprimer.
- **Des étapes** (six au plus) : « Une pizza au choix », « Un dessert », « Une boisson ». Chacune propose une catégorie entière ou une liste de plats, avec un minimum et un maximum de choix, et un supplément possible par plat (« Pizza Burrata : + CHF 3 »).
- **`prix_menu(menu, choix)`** : vérifie un choix (nombre par étape, plat proposé, plat en vente et pas épuisé) et rend le prix du menu plus les suppléments. C'est ce que le panier et le paiement appelleront.
- **Journal** : objets `menu`, `menu_etapes`, `menu_archive`, `menus`.

## Pas encore branché (avec `client-commande`)

- Afficher les menus en vente sur la carte (`menus_publics()`), choisir les plats de chaque étape.
- Une ligne « menu » dans le panier et la commande : prix venu de `prix_menu`, revérifié au paiement ; les plats choisis vont chacun au ticket de leur poste (pizza ou cuisine).
- TVA : celle des plats à emporter, comme le reste de la commande.
