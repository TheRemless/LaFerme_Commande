# Mode d'emploi (brouillon)

Brouillon tiré de l'audit du 12.11.2026. Il décrit le site tel qu'il est aujourd'hui, sans les corrections proposées dans `docs/audits/gerant.md`. Le numéro à appeler reste à remplir.

---

## Page 1. La tablette (à afficher en cuisine)

Numéro à appeler en cas de problème : ______________________

### Ouvrir le service

1. Allumer la tablette et ouvrir La Ferme depuis l'écran d'accueil.
2. Toucher « Démarrer le service ». Le son s'active et l'écran reste allumé.
3. Lire la ligne grise en haut. Si elle dit « Livraison fermée » ou « En pause » sans raison, ouvrir « Pause, délai, ruptures » et rouvrir.

Ne pas toucher « Continuer sans son ». Sans son, personne n'entend les commandes.

### Une commande arrive

- La tablette sonne toutes les 4 secondes et un bandeau jaune s'affiche.
- L'heure proposée est écrite en grand. Les boutons −5, +5 et +15 la changent.
- Toucher « Accepter pour… ». Les tickets sortent aux postes pizza et cuisine.
- La commande passe dans l'onglet « En cours ». Aller la chercher là.
- Pour refuser, toucher « Refuser », choisir un motif puis confirmer. Le client reçoit le motif par e-mail. Une commande payée en ligne est remboursée en entier.

### Pendant la préparation (onglet « En cours »)

- Toucher « Prête au comptoir » ou « Partie en livraison ». Le client reçoit un e-mail.
- À emporter payé au comptoir : toucher « Encaissée » quand le client paie. Toujours avant « Retirée », sinon ce n'est plus possible.
- À la fin, toucher « Retirée » ou « Livrée ».
- « Changer l'heure » envoie la nouvelle heure au client.

### Un client appelle

- Il veut changer sa commande. Ce n'est pas possible sur la tablette. Annuler la commande et lui demander de recommander.
- Il veut annuler. Toucher « Annuler la commande », écrire « À votre demande » dans « Autre motif » puis toucher « Refuser et rembourser ». Le lien « Annuler » juste à côté ferme seulement le panneau.
- On ne peut plus annuler une commande prête ou partie. Noter son numéro et appeler le numéro en haut de cette page.

### Pendant le service (bouton « Pause, délai, ruptures »)

- Trop de monde. Toucher « Pause 30 min », « Pause 1 h » ou « Pause jusqu'à reprise ». Les commandes déjà reçues restent à faire.
- Délai trop court. Toucher +5. Il ne compte que pour les commandes à emporter.
- Pas de livreur. Toucher « Fermer la livraison ». Le retrait reste ouvert. Au service suivant, toucher « Rouvrir la livraison ».
- Un plat est fini. Chercher le plat puis toucher « Disponible », qui devient « Épuisé ». Il revient tout seul le lendemain.
- Une commande déjà reçue contient ce plat. Appeler le client, puis refuser avec le motif « Un des plats commandés est épuisé. ». Il peut recommander autre chose.
- Les suppléments (burrata, jambon…) ne se mettent pas en rupture ici. Appeler le gérant.
- Fermer les réglages avec « Fermer les réglages » pour revoir les commandes.

### Les onglets

| Onglet | Ce qu'il montre |
|---|---|
| À accepter | Les commandes qui attendent une réponse |
| En cours | Les commandes acceptées |
| À l'avance | Les commandes pour un autre jour. Les accepter le jour même, car le ticket sort dès qu'on accepte |
| Terminées | Les commandes finies ou refusées aujourd'hui |

### Que faire si…

1. Rien ne sonne. Le bandeau jaune dit « Le son est coupé ». Recharger la page puis toucher « Démarrer le service ». Vérifier le volume de la tablette.
2. Bandeau « Pas de connexion depuis… ». Vérifier le Wi-Fi de la tablette. Les nouvelles commandes ne s'affichent plus. Au bout de 3 minutes, le site met les commandes en ligne en pause tout seul.
3. Imprimante « plus de papier », « capot ouvert » ou « hors ligne ». Changer le rouleau, fermer le capot ou vérifier le câble et l'interrupteur. Les tickets en attente sortent quand elle revient. En attendant, toucher « Ticket » sur la commande pour la lire sur la tablette. Si un ticket est en « échec », toucher « Réimprimer ».
4. Bandeau « Pause automatique ». La tablette n'a pas répondu pendant le service. Ouvrir « Pause, délai, ruptures » puis toucher « Reprendre les commandes ».
5. La tablette demande un e-mail. Elle a été déconnectée. Entrer l'e-mail de l'équipe, lire le code reçu par e-mail puis le taper. Ne jamais toucher « Déconnexion » pendant un service.

---

## Page 2. Le back-office (gérant)

Adresse : la page `/gestion` du site, au téléphone ou à l'ordinateur. Connexion avec l'e-mail du gérant et le code reçu par e-mail.

Numéro à appeler en cas de problème : ______________________

Sur le téléphone, les rubriques défilent de côté. Faire glisser la barre vers la gauche pour voir Imprimantes, Importer le tableau, Export comptable et Journal.

### Carte

- Changer un prix. Chercher le plat, toucher sa ligne, écrire le prix (18 ou 18.50), laisser « Prix validé » coché, toucher « Enregistrer le plat ». Le site change tout de suite.
- Retirer un plat de la vente. Décocher « Commandable sur le site » puis enregistrer. Pour la journée seulement, utiliser « Épuisé » sur la tablette.
- Changer la photo. Choisir un nom dans la liste « Photo ». Une nouvelle photo passe par le numéro ci-dessus.
- Allergènes, provenance et description se changent sur la même fiche.
- Retraits gratuits. Les écrire séparés par des virgules puis toucher « Enregistrer les retraits ». Ce bouton est à part du bouton du plat.

### Suppléments et pâtes

- Chaque supplément a son prix, sa case « Validé » et sa case « Proposé ». Décocher « Proposé » le retire du site jusqu'à ce qu'on le recoche.
- Toucher « Enregistrer » sur la ligne du supplément.

### Livraison et horaires

- Zone. Frais, minimum, délai annoncé, zone ouverte ou non, puis « Enregistrer la zone ». Les communes ne se changent pas ici.
- Rush en livraison. Augmenter « Délai annoncé » de chaque zone. Le remettre après le service.
- Horaires. Quatre heures par service, puis « Enregistrer » sur la ligne du service.
- Fermeture (jour férié, vacances). En bas de la page, remplir « Du », « Au (inclus) » et le motif, puis « Ajouter la fermeture ». Une fermeture couvre des jours entiers. Pour fermer un seul service, mettre la tablette en « Pause jusqu'à reprise ».
- Avant une fermeture, regarder l'onglet « À l'avance » de la tablette. Les commandes déjà prises pour ces jours restent : les annuler une par une.

### Imprimantes

- La rubrique montre l'état de chaque imprimante.
- Ne pas toucher « Nouvelle adresse » ni « Désactiver » sans avoir appelé le numéro ci-dessus. L'imprimante s'arrête aussitôt.
- « Alerte de commande en attente » règle après combien de minutes un e-mail part quand une commande n'est pas acceptée.

### Importer le tableau

- Remplir seulement les cases jaunes de `validation-carte.xlsx`. Prix en chiffres (18 ou 18.50, sans « .- » ni « CHF »). Commandable « oui » ou « non ».
- Toucher « Voir les changements », lire les avertissements, puis « Appliquer ».
- Une ligne avec un avertissement n'est pas prise. La corriger dans le tableau puis réimporter.

### Export comptable

- Choisir « Du » et « Au » puis toucher « Télécharger le fichier CSV ». Le fichier s'ouvre dans Excel.
- Une ligne par vente encaissée, puis le total par taux de TVA.
- Une commande payée au comptoir n'y est que si quelqu'un a touché « Encaissée » sur la tablette.

### Journal

- Qui a changé quoi et quand.
- Il n'y a pas de bouton pour revenir en arrière. Lire l'ancienne valeur et la retaper.

### Ce qui ne se fait pas ici (appeler le numéro ci-dessus)

- Ajouter ou retirer un employé.
- Rembourser une commande prête, partie ou livrée, ou seulement une partie.
- Ajouter un plat, un supplément ou une catégorie.
- Changer les communes d'une zone.
- Remplacer une imprimante.

### Que faire si…

1. « Prix invalide ». Écrire 18 ou 18.50, sans « .- » ni « CHF ».
2. Le code n'arrive pas. Attendre 30 secondes, toucher « Renvoyer un code » et regarder les courriers indésirables.
3. « Réservé au gérant ». Le compte utilisé est un compte d'équipe. Se reconnecter avec l'e-mail du gérant.
4. « Colonnes de l'onglet « Carte » introuvables ». Le tableau a été modifié. Repartir du fichier d'origine sans renommer les onglets ni les colonnes.
5. Une commande au comptoir manque dans l'export. Elle n'a pas été marquée « Encaissée ». Ce n'est plus rattrapable sur la tablette : la noter à part pour la fiduciaire.
