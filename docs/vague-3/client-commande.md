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

## Zone fermée jusqu'à une heure (#95)

Quand le gérant ferme une zone jusqu'à une heure (neige, livreur malade), le client de cette zone lit « La livraison reprend à 21h00 dans votre quartier. » au lieu de « hors zone », avec le bouton « Commander à emporter ». Le même texte revient au panier et au paiement. Le motif saisi au back-office n'est pas montré au client.

## Service fédéral des adresses en panne

Le panier et le paiement revérifient l'adresse de livraison auprès du registre fédéral (geo.admin.ch). S'il ne répond pas, le client lit « Le service fédéral des adresses ne répond pas. Nous ne pouvons pas vérifier votre adresse de livraison pour le moment. Commandez à emporter, ou appelez-nous au 022 792 16 89. ». Le numéro se touche pour appeler. « Commander à emporter » passe le choix à emporter en gardant le panier, puis l'accueil montre l'heure du retrait. Texte dans `src/lib/registre-panne.ts`, affichage `src/components/PanneRegistre.tsx`, tests `tests/unit/registre-panne.test.ts` et `tests/e2e/registre-panne.spec.ts`. Ce message ne paraît plus que si le gérant a éteint le repli ci-dessous.

Repli sur le NPA (décision C15 de Jérémy, 13.11.2026, allumé). Pendant la panne, l'adresse tapée est acceptée sur son seul NPA, au prix de la zone livrée la plus chère de ce NPA : annoncer la localité d'une zone moins chère ne rapporte rien. Elle est enregistrée avec la commande comme « non vérifiée ». Sur la tablette, la commande arrive avec l'avertissement « Adresse non vérifiée, le registre fédéral était en panne. Contrôlez la rue et le numéro dans le 1213 avant d'accepter. » ; elle sort donc de l'acceptation en série et s'accepte seule. Le client ne voit rien de plus que des frais parfois plus élevés. Au paiement, le registre est de nouveau interrogé : revenu entre-temps, l'adresse est vérifiée normalement et le prix redevient celui de sa zone. La panne doit être réelle : un délai dépassé, une erreur réseau ou une réponse 5xx, confirmés par une adresse connue (Route de Chancy 132, 1213) qui ne répond pas non plus, contrôle gardé 60 secondes. Une réponse 4xx veut dire « adresse introuvable », et le texte envoyé au registre ne dépasse jamais 10 mots : un client ne peut pas provoquer le repli en tapant une rue à rallonge. Réglage `npa_seul_en_panne_actif`, case « Registre des adresses en panne » des Réglages généraux du back-office. Code `src/lib/zone-serveur.ts` (`surLeNpaSeul`) et `zonePourNpaSeul` dans `src/lib/service.ts`.

## Commande que personne n'accepte (décision C13)

Pendant un service, une commande « dès que possible » que personne n'accepte dans les 15 minutes qui suivent son paiement (ou sa création, au comptoir) est refusée par la surveillance, comme sur la tablette. Payée en ligne, elle est remboursée en entier. Le client reçoit l'e-mail habituel avec ce motif : « Elle attendait depuis 15 minutes sans confirmation de notre part. Pour commander quand même, appelez-nous au 022 792 16 89. » Ensuite les commandes en ligne passent en pause (une pause déjà en cours reste) et le gérant reçoit une alerte. Jamais hors service, jamais pour une commande à une heure choisie. Réglages `refus_automatique_actif` (interrupteur des Réglages généraux, allumé) et `refus_automatique_minutes` (15, minimum 5). Code `src/lib/refus-automatique.ts`, test `tests/unit/refus-automatique.test.ts`.

Le refus tourne seulement dans la fonction planifiée de Netlify (chaque minute, production), jamais dans une requête de la tablette. Un tour pose d'abord la pause et envoie l'alerte, puis refuse au plus trois commandes en quatre secondes ; les suivantes passent à la minute d'après. Une commande refusée mais pas remboursée (fonction coupée, Stripe en panne) est reprise deux minutes après le refus, chaque minute pendant une heure, avec une alerte au gérant au premier échec. Sur une préversion ou en local, rien ne tourne seul.

## Heure annoncée en fourchette (#103)

« Dès que possible, entre 19h35 et 19h50 » à l'accueil, rappelé au paiement. La largeur se règle au back-office (`fourchette_livraison_minutes`, `fourchette_retrait_minutes`) ; à 0, on revient à « vers 19h40 ». Les cases de chiffres et l'en-tête gardent l'heure unique.

## Reprendre sa dernière commande (#108)

Un client connecté voit en haut de l'accueil « Votre dernière commande, vendredi 13 novembre » et « Reprendre cette commande ». Un tap remet les plats dans le panier (un plat épuisé est nommé, pas repris), garde le mode et, pour une livraison, la dernière adresse. Le bouton devient « Voir le panier ». Un panier en cours n'est jamais remplacé sans accord.

## Messages du gérant aux clients (bannière)

Un message programmé au back-office (rubrique Messages aux clients, `docs/messages-clients.md`) s'affiche sous l'en-tête, sur une bande gris béton en texte blanc. Un message « accueil » ne paraît que sur l'accueil ; un message « partout », aussi sur la carte, le panier et le paiement. Il apparaît à son début et part à sa fin à la minute près, même sur une page restée ouverte. Retiré au back-office, il quitte aussitôt l'accueil, la carte et le panier. Le texte du gérant est affiché tel quel, jamais interprété comme du HTML. Composant `src/components/MessagesClients.tsx`, test `tests/e2e/messages-bandeau.spec.ts`, captures `messages-*.png`.

## Construit mais éteint, en attente d'une décision de Jérémy

Chaque point s'allume par un réglage en base (`reglages`), sans redéploiement. Éteint, le client ne voit rien et le serveur ignore ce que le navigateur enverrait.

| Réglage | Décision | Ce que voit le client une fois allumé | PR |
|---|---|---|---|
| `plats_populaires_actifs` | C7 | Section « Les plus commandés » en tête de la carte : les six plats les plus vendus des 28 derniers jours | #112 |
| `suggestion_panier_active` | P2 du carnet | Au panier, une seule ligne : la boisson (ou le dessert) la plus commandée, avec « Ajouter » | #112 |
| `couverts_actifs` | C8 | Au paiement, une case « Couverts et serviettes », décochée par défaut | #118 |
| `prenom_par_ligne_actif` | C5 | Dans la fiche d'un plat, « Pour qui ? » ; au panier et sur le ticket, « Pour Léa » | #118 |
| `codes_promo_actifs` | C2 | Au paiement, un champ « Code ». Un QR peut apporter le code dans l'adresse (`/?code=FLYER`) | #124 |

Codes promo : la remise est calculée, appliquée et notée par la base dans la même transaction que la commande (`creer_commande_code`), sous verrou. Un code « une fois par client » ne sert donc qu'une fois, même si plusieurs commandes partent en même temps. Le panier montre un aperçu sans aucune donnée du client.

## Performance sur téléphone

`scripts/audit/perf-mobile.mjs` mesure, sur un build de production local, Chrome en 4G lente (1,6 Mbit/s, 150 ms) avec un processeur ralenti quatre fois, comme le profil mobile de Lighthouse. Médiane de trois chargements, 13.11.2026 :

| Page | Plus grand affichage (LCP) | Transféré | Dont JavaScript |
|---|---|---|---|
| Accueil `/` | 2,4 s | 441 Ko | 122 Ko |
| Carte `/carte` | 1,8 s | 650 Ko | 140 Ko |
| Panier `/panier` | 2,0 s | 313 Ko | 140 Ko |
| Paiement `/commande` | 1,5 s | 314 Ko | 143 Ko |

Les quatre pages restent sous 2,5 s, le seuil « bon » de Google. L'accueil répond au doigt après 2,4 s ; un tap plus tôt n'est pas perdu (CM-21). Le poids de l'accueil vient surtout de sa photo.

## Mesurer le parcours

`AUDIT_BASE=http://localhost:3226 node scripts/audit/mesure-parcours.mjs` compte les gestes (taps, caractères) et estime le temps de quatre parcours sur téléphone, en local seulement.

| Parcours | Avant (13.11.2026, matin) | Après la vague 3 |
|---|---|---|
| Nouveau client, livraison, paiement en ligne | 19 taps, 89 caractères, environ 58 s | inchangé, aucun geste obligatoire ajouté |
| Nouveau client, à emporter, au comptoir | 12 taps, 58 caractères, environ 38 s | inchangé |
| Client fidèle connecté, livraison à l'adresse gardée | 13 taps, environ 27 s | 13 taps, environ 28 s |
| Client fidèle connecté, « Reprendre cette commande » | (n'existait pas) | 6 taps, environ 15 s |

Le temps estimé compte 1 s par tap, 0,28 s par caractère et 1,5 s de lecture par écran, plus l'attente réelle. Il ne compte pas le temps passé à choisir sur la carte.
