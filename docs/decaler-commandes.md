# Décaler les commandes en cours (vague 3, bo-operations)

Le coup de feu et le retard du soir allongent les heures des commandes **à venir**. Vendredi 20h, trente commandes sont déjà acceptées et le four prend vingt minutes de retard : leurs clients gardent une heure fausse. Un geste décale désormais de N minutes toutes les commandes en cours, ou celles d'un poste, et prévient chaque client par e-mail.

Base `supabase/migrations/20261130230000_decaler_commandes.sql`, serveur `src/lib/decalage.ts`, back-office `/api/gestion/decalage` (gérant) et bloc « Retard sur les commandes en cours » sous le coup de feu (rubrique Livraison et horaires). La tablette a le même geste sur les mêmes fonctions (session `tablette`).

## La règle

- **Commandes visées** : acceptées ou en préparation, dont l'heure promise tombe dans les 90 prochaines minutes ou est déjà passée. Les commandes pour plus tard ne bougent pas, la cuisine a le temps de rattraper. Les commandes prêtes ou parties non plus.
- **Un poste** (four ou cuisine) : seulement les commandes qui ont des lignes à ce poste et dont ce poste n'a pas fini (`commande_postes.pret_le` vide). Une commande pizza et lasagne dont les pizzas sont sorties ne bouge pas pour un retard du four.
- **Décalage** : de 5 à 90 minutes. Chaque heure promise recule d'autant.
- **Clients** : un e-mail « nouvelle heure » par commande et par geste (`courrielNouvelleHeure`, le même que depuis la tablette, priorité 2 du quota d'e-mails). Un envoi refusé par le quota ou raté ne bloque ni le geste ni les autres e-mails. Il est noté dans l'historique de la commande.
- **Double appui** : chaque geste porte une clé tirée au moment de la confirmation. La même clé ne décale qu'une fois et n'envoie aucun e-mail de plus (table `decalages_commandes`).
- **Qui** : l'équipe du restaurant (service, gérant, responsable), revérifiée en base (`equipe_nom`). Le back-office l'ouvre au gérant.
- **Traces** : un événement par commande (« heure … (décalage +20 min) », par « tablette:Prénom »), un seul `journal_gestion` (objet `decalage`, clé `tous`, `pizza` ou `cuisine`, avec les minutes et le nombre de commandes). Aucune donnée de client dans le journal.

## L'écran

Retard (+5 à +60 min), commandes (tous les postes, four, cuisine) et un aperçu relu chaque minute : « 23 commandes en cours, 23 clients prévenus par e-mail ». La confirmation redit le nombre de commandes, le retard et l'e-mail. Le message de fin dit combien de commandes ont bougé et combien d'e-mails sont partis.

## Pour la tablette

- `apercuDecalage(poste | null)` : `{ commandes, clients }`.
- `decalerCommandes({ minutes, station, cle }, personnel)` : `{ ok, deja, minutes, commandes, prevenus }` ou `{ ok: false, erreur }` en français. `cle` vient de `crypto.randomUUID()` au moment de la confirmation.

## Tests

`tests/unit/decaler-commandes-sql.test.ts` (fenêtre, statuts, poste et poste fini, double appui, bornes, rôles, droits), `tests/unit/decalage.test.ts` (un e-mail par commande, aucun au double appui), `tests/e2e/gestion-service-v3.spec.ts` (aperçu seulement : le geste décalerait les commandes des autres tests). Capture : `docs/rendus/vague-3/bo-operations/horaires-decaler-1024.png`.
