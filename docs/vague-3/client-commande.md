# Parcours de commande du client (vague 3, `client-commande`)

Ce que le client voit de l'accueil au paiement. L'équipe s'en sert pour répondre au téléphone. Un paragraphe par sujet, avec la PR qui l'a apporté.

## Avant de payer, rien n'est gris sans raison (#62)

- Créneau complet. Si d'autres clients ont rempli le créneau depuis que le client l'a choisi, le panier le dit tout de suite, avec le lien « Changer l'heure ». Le serveur revérifie au paiement. Un client qui revient d'un paiement annulé garde sa place : sa propre commande en attente ne compte pas contre lui.
- Calcul lent. Au-delà d'une seconde, « Calcul du total en cours… » s'affiche au-dessus du bouton.
- Réseau coupé. « Le total n'a pas pu être calculé. Vérifiez la connexion. », avec « Réessayer ».
- Retour sur l'onglet. Le panier est recalculé quand le client revient sur la page ou que le réseau revient : un plat a pu s'épuiser, une pause commencer, un créneau se remplir.
- Plat refusé pour ce moment. « Retirez-le du panier ou changez de créneau. »

## Plats indisponibles grisés sur la carte (grisage)

Un plat réservé à un service (midi, soir), à un mode (livraison, à emporter), à certains jours, ou épuisé jusqu'à une date reste visible sur la carte, grisé, avec sa raison (« Seulement en livraison. », « Épuisé. De retour le vendredi 21 novembre. »). C'est le même texte que le serveur oppose au panier et au paiement (`motifPlat`, réglages de la carte au back-office).

## Modifier une ligne du panier (#76)

« Modifier » sous chaque ligne, au panier et dans le panier de côté de la carte. La fiche du plat se rouvre avec les choix, les retraits, la note et la quantité. « Valider, CHF … » met la ligne à jour à sa place. Un plat épuisé entre-temps se rouvre sans pouvoir être validé.

## Allergie ou intolérance (#71)

Un champ facultatif au paiement, pour toute la commande, séparé de la note par plat (120 caractères). Il part avec la commande (`commandes.allergie`) et s'affiche à la cuisine (tablette et tickets, session `tablette`). Il n'est jamais gardé dans le compte du client ni proposé à la commande suivante. Dans le navigateur, il est oublié après deux heures. Texte d'aide en attente de la décision de Jérémy (C10).

## Commander pour quelqu'un d'autre (#84)

Une case au paiement, « Je commande pour quelqu'un d'autre », ouvre « Son nom » et « Son téléphone » (`commandes.destinataire`). Celui qui commande paie et reçoit les e-mails. La personne indiquée reçoit la livraison ou vient chercher la commande : c'est elle qu'on appelle si besoin.

## Mesurer le parcours

`AUDIT_BASE=http://localhost:3226 node scripts/audit/mesure-parcours.mjs` compte les gestes (taps, caractères) et estime le temps de trois parcours sur téléphone, en local seulement. Référence du 13.11.2026 : nouveau client en livraison 19 taps, 89 caractères, environ 58 s ; à emporter 12 taps, environ 38 s ; client fidèle connecté 13 taps, environ 27 s.
