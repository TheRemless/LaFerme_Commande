# Mise en service au restaurant

De zéro au premier vrai service, dans l'ordre. Ce guide part du moment où le site est en ligne avec son adresse définitive ([mise-en-ligne.md](mise-en-ligne.md), phase 4). Il s'adresse à Jérémy, sur place, avec le matériel devant lui.

Joué le 13.11.2026 sur la version `423270eb`, en local, avec le jeu de commandes de rush. Les durées sont des estimations. Rien n'a été chronométré sur le vrai matériel, car aucune imprimante n'était branchée.

Les fiches à imprimer pour l'équipe sont dans [fiches/](fiches/).

## Réponses courtes aux trois questions de Jérémy

| Question | Réponse |
|---|---|
| Peut-on accepter les commandes depuis n'importe quel téléphone ou tablette ? | Oui. La tablette est une page du site, `/tablette`. Elle s'ouvre sur tout appareil qui a un navigateur récent et Internet (tablette, téléphone, ordinateur). Il faut un compte de l'équipe avec l'accès « Tablette ». L'appareil ne sonne qu'après « Démarrer le service ». |
| Comment régler les imprimantes ? | Chaque imprimante reçoit une adresse créée dans le back-office, rubrique « Imprimantes ». On colle cette adresse dans les réglages CloudPRNT de l'imprimante. Détail à l'étape 4. |
| Comment ça se passe pour les livreurs ? | Chaque livreur a un compte « Livreur » et ouvre `/livreur` sur son propre téléphone. Le comptoir lui donne ses livraisons depuis l'onglet « Livraisons ». Il touche « Je pars » puis « Livrée ». Détail à l'étape 7. |

## Ce qu'il faut avoir en main

| Quoi | Pour quoi | État au 13.11.2026 |
|---|---|---|
| L'adresse du site | Tout | À noter en tête de [pannes.md](pannes.md) |
| Un compte gérant au nom de Jérémy | Le back-office | Créé une fois dans Supabase ([mise-en-ligne.md](mise-en-ligne.md), phase 2) |
| Une adresse e-mail par personne de l'équipe, lisible sur place | Recevoir le code de connexion à 8 chiffres | À réunir avant le jour J |
| La tablette du comptoir, son chargeur, le Wi-Fi du restaurant | Accepter et suivre les commandes | Achat non confirmé |
| Une ou deux imprimantes Star mC-Print3 (MCP31CI BK), rouleaux de 80 mm, un câble réseau par imprimante | Les tickets pizza et cuisine | Achat non coché dans [mise-en-ligne.md](mise-en-ligne.md) |
| Un ordinateur sur le même réseau que les imprimantes | Ouvrir la page de réglages de chaque imprimante | |
| Le téléphone de chaque livreur, avec Internet mobile | La page `/livreur` | |
| Un téléphone en 4G, hors Wi-Fi du restaurant | Passer la commande d'essai comme un client. Sert aussi de tablette de secours | |
| Les pages imprimées : [pannes.md](pannes.md) et les six fiches | Près de la tablette et à chaque poste | Le numéro à appeler reste à écrire dessus |

## La veille ou le matin (environ 1h30)

### 1. Vérifier les réglages du restaurant (20 min)

Back-office, `/gestion`, avec le compte gérant.

| Rubrique | Ce qu'on vérifie |
|---|---|
| Livraison et horaires, onglet « Horaires » | Les quatre heures de chaque service |
| Onglet « Zones » | Frais, minimum, délai annoncé, zone ouverte. « Tester une adresse » avec une vraie adresse de chaque zone |
| Onglet « Fermetures » ainsi que « Calendrier » | Les jours fermés du mois |
| Carte | Aucun plat « à compléter ». Un plat sans prix validé ou sans allergènes n'est pas en vente |
| Réglages généraux, « E-mail qui reçoit les alertes » | Une adresse lue pendant le service. Le champ est vide au départ |
| Réglages généraux, « Rythme de la cuisine et des livraisons » | Les débits. À zéro, la file n'allonge pas les heures annoncées. Voir le manque M6 |
| Imprimantes, « Alerte de commande en attente » | Le délai en minutes avant l'e-mail d'alerte (5 par défaut) |

### 2. Créer les comptes de l'équipe (15 min)

Back-office, rubrique « Équipe », cadre « Ajouter quelqu'un » en bas de page. Prénom, e-mail, accès, puis « Ajouter ».

| Accès | Pour qui | Ce qu'il ouvre |
|---|---|---|
| Tablette | Comptoir, pizzaiolo, cuisine | `/tablette` ainsi que les écrans de poste |
| Responsable de service | Celui qui tient le service sans le gérant | La tablette, les remboursements, les commandes passées |
| Tablette et back-office | Jérémy, Giuseppe | Tout |
| Livreur | Chaque livreur | `/livreur`, rien d'autre |

- Une personne a un seul accès. Un compte gérant n'ouvre pas `/livreur` (le site répond « Votre compte donne accès à la tablette »). Voir M4.
- La tablette du comptoir reste connectée 60 jours. Chaque geste est signé du prénom du compte connecté.
- Un livreur reste connecté 12 heures. Il se reconnecte à chaque service.

### 3. Installer la tablette (10 min)

1. Brancher la tablette à poste fixe, sur le Wi-Fi du restaurant.
2. Ouvrir `https://<adresse du site>/tablette`. Entrer l'e-mail du compte, puis le code reçu.
3. Ajouter la page à l'écran d'accueil. Elle s'ouvre alors en plein écran.
4. Monter le volume au maximum. Toucher « Démarrer le service ». Ne pas toucher « Continuer sans son ».
5. Lire la première ligne. « Commandes ouvertes » doit s'afficher, avec le temps de préparation.

### 4. Brancher les imprimantes (30 min par imprimante)

Règle de sécurité ([impression.md](impression.md)) : on crée l'imprimante dans le back-office seulement quand elle est branchée et allumée, puis on colle son adresse tout de suite.

1. Charger le rouleau. Brancher le câble réseau au routeur ou au switch. Allumer.
2. Mettre le micrologiciel à jour (version 3.2 au moins, d'après [impression.md](impression.md)).
3. Sur l'ordinateur, ouvrir la page de réglages de l'imprimante en tapant son adresse IP dans le navigateur. La façon d'obtenir cette adresse IP et l'identifiant de cette page ne sont pas vérifiés : le manuel en ligne de Star n'a pas pu être lu le 13.11.2026. Suivre la notice de la boîte. Voir M1.
4. Back-office, rubrique « Imprimantes ». Écrire un nom (« Four pizza »), choisir le poste, toucher « Ajouter l'imprimante ».
5. L'adresse s'affiche une seule fois sous « Adresse CloudPRNT, à copier maintenant ». Toucher « Copier ».
6. Dans la page de l'imprimante, rubrique CloudPRNT : activer CloudPRNT en HTTP, coller l'adresse dans « Server URL », régler l'intervalle à 10 secondes, enregistrer.
7. Retour au back-office. La ligne de l'imprimante passe de « Jamais connectée » à « en ligne » dans la minute.
8. Toucher « Imprimer un ticket de test ». Le ticket « TEST » sort de cette imprimante, avec son nom et l'heure.
9. Refaire pour la deuxième imprimante, avec le poste « Cuisine ».

Si la ligne dit « en ligne » mais que rien ne sort, toucher « Nouvelle adresse » puis recommencer à l'étape 5.

Sans imprimante pour un poste, les tickets de ce poste s'affichent sur la tablette (bouton « Ticket »). Le service reste possible avec une seule imprimante, ou sans.

### 5. Écrans de poste, si on les essaie (5 min)

Un écran au four ou en cuisine se règle comme la tablette, avec un compte « Tablette », sur `/tablette/poste/pizza` ou `/tablette/poste/cuisine`. Les tickets papier continuent de sortir. Voir M2 avant de s'y fier.

### 6. Planning des livreurs (5 min)

Back-office, rubrique « Livreurs ».

1. Dans l'onglet « Semaine type », cocher les services de chaque livreur, puis « Enregistrer » au bout de sa ligne.
2. Dans l'onglet « Les 7 prochains jours », chaque service doit afficher au moins un livreur. Un service ouvert sans livreur est encadré.

### 7. Préparer chaque livreur (5 min par livreur)

1. Il ouvre `https://<adresse du site>/livreur` sur son téléphone.
2. Il entre son e-mail, puis le code reçu.
3. Il ajoute la page à l'écran d'accueil.
4. On lui donne sa fiche ([fiches/livreur.md](fiches/livreur.md)).

La connexion par un code affiché sur la tablette (sans e-mail) est construite. Elle est fermée dans la base au 13.11.2026 et le back-office n'a pas de case pour l'ouvrir. Voir M3.

## Le jour J, une heure avant l'ouverture (environ 40 min)

### 8. Commande d'essai à emporter (10 min)

1. Avec le téléphone en 4G, commander un plat pizza et un plat cuisine, à emporter, payés au comptoir.
2. La tablette sonne. Toucher « Accepter pour… ».
3. Un ticket sort au four, un autre en cuisine. Chacun ne porte que ses lignes.
4. Onglet « En cours ». Toucher « Prête ». L'e-mail « prête » arrive sur le téléphone.
5. Toucher « Retirée, espèces ». La commande passe dans « Terminées ».

### 9. Commande d'essai en livraison (15 min)

1. Commander en livraison à une vraie adresse de la zone 1, payée en ligne (TWINT ou carte). Petit montant.
2. Accepter sur la tablette.
3. Onglet « Livraisons ». Toucher « À » suivi du prénom du livreur.
4. Sur le téléphone du livreur, la livraison apparaît. La page ne sonne pas et ne vibre pas (M5). Il touche « Je pars ». L'e-mail « en route » arrive.
5. Il touche « Livrée ». La commande passe dans « Terminées ».
6. Back-office, « Commandes », ouvrir la commande, onglet « Gestes », « Rembourser », « Tout ce qui reste ». Vérifier que le remboursement arrive.

### 10. Essai de refus (5 min)

Commander une troisième fois, payée en ligne. Toucher « Refuser », choisir un motif, confirmer. Le client reçoit le motif et le remboursement part.

### 11. Derniers contrôles avant d'ouvrir (10 min)

| Contrôle | Où | Attendu |
|---|---|---|
| Le son | Tablette | Elle a sonné aux trois essais |
| Les imprimantes | Tablette, sous les onglets | « Imprimantes en ligne. » |
| Le papier | Chaque imprimante | Un rouleau de réserve à côté |
| La livraison | Tablette, première ligne | Pas de « Livraison fermée », pas de « En pause » |
| Les livreurs | Onglet « Livraisons » | « Prévus ce soir » avec les bons prénoms. Sous chaque prénom, l'heure de la dernière mise à jour de son téléphone |
| Les ruptures | « Pause, délai, ruptures » | Aucun plat « Épuisé » par erreur |
| Les alertes | Boîte e-mail des alertes | Ouverte sur un téléphone |
| Les fiches | Comptoir, four, cuisine, livreurs | Imprimées, numéro à appeler écrit |
| Les essais | Back-office, « Commandes » | Les trois commandes d'essai terminées, refusée ou remboursées |

## Pendant le premier service

- Jérémy reste au comptoir avec le back-office ouvert sur son téléphone (`/gestion`). L'accueil montre les alertes.
- Trop de commandes : « Pause, délai, ruptures », puis « +5 » sous « Retard ce soir », ou une pause de 30 minutes.
- Plus de livreur : « Fermer la livraison ». Le retrait reste ouvert.
- Tablette en panne : n'importe quel téléphone ouvre `/tablette` et prend le relais ([pannes.md](pannes.md)).

## Après le service (15 min)

1. Tablette, onglet « Terminées ». Une commande retirée sans encaissement garde ses boutons « Espèces » et « Carte ».
2. Back-office, « Clôture du jour ». Compter la caisse, écrire les espèces et le total du ticket du terminal, toucher « Clôturer le jour », puis « Imprimer ».
3. Noter ce qui a gêné l'équipe.

## Manques trouvés en jouant ce guide

La liste classée, avec le propriétaire de chaque point, est dans le fichier d'état de `produit-gestion`. Ceux que ce guide cite :

| N° | Manque | Ce qu'on fait le jour J en attendant |
|---|---|---|
| M1 | Aucune imprimante réelle n'a été branchée. L'accès à sa page de réglages n'est pas vérifié | Brancher la première imprimante plusieurs jours avant |
| M2 | Écran du poste pizza : à 15h10, « Reste à sortir » additionnait les commandes du soir. Vu sur le jeu de rush, à revérifier | Se fier aux tickets papier |
| M3 | Connexion d'un livreur par code : fermée dans la base, pas de case au back-office | Chaque livreur se connecte par e-mail |
| M4 | Un gérant n'ouvre pas `/livreur` | Le patron qui livre fait noter « Partie » puis « Livrée » sur la tablette |
| M5 | La page du livreur ne sonne pas quand on lui donne une livraison | Le comptoir appelle le livreur |
| M6 | Débits du four et de la cuisine à zéro dans la base locale | Vérifier la valeur dans « Réglages généraux » sur le vrai site |
