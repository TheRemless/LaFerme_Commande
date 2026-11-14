# Fiche gérant

Le back-office est à la page `/gestion` du site, sur téléphone ou ordinateur. La tablette est à la page `/tablette`.

En cas de problème, appeler le restaurant : 022 792 16 89

## Ouverture (10 minutes avant le service)

| Je vérifie | Où |
|---|---|
| La tablette sonne | Tablette, « Démarrer le service » |
| « Imprimantes en ligne. » | Tablette, sous les onglets |
| Un rouleau de réserve à chaque imprimante | Sur place |
| Au moins un livreur prévu | Back-office, « Livreurs », « Les 7 prochains jours » |
| Aucune alerte en attente | Back-office, accueil |
| Aucun plat « Épuisé » par erreur | Tablette, « Pause, délai, ruptures » |
| Le plat du jour | Back-office, « Plat du jour », « Publier le plat du jour » |

## Pendant le rush

| Ce qui arrive | Ce que je fais |
|---|---|
| La cuisine prend du retard | Tablette, « Pause, délai, ruptures », « +5 » sous « Retard ce soir ». Les heures annoncées s'allongent. |
| Les commandes déjà prises seront en retard | Back-office, « Livraison et horaires », onglet « Ce soir ». Ajouter des minutes aux commandes en cours. Les clients sont prévenus. |
| Trop de monde | « Pause 30 min », « Pause 1 h » ou « Pause jusqu'à reprise ». Les commandes reçues restent à faire. |
| Plus de livreur | « Fermer la livraison ». Le retrait reste ouvert. |
| Un livreur malade | Back-office, « Livreurs », « Absent » à côté de son nom. |
| Un renfort arrive | Même écran, « Ajouter un livreur… » sous le service. |
| Le four tombe en panne | Back-office, « Carte », « Four en panne… ». L'écran liste les commandes touchées. Appeler chaque client. |
| Une imprimante « en ligne » ne sort rien | Papier coincé ou mal mis, le site ne le voit pas. Remettre le rouleau, puis « Réimprimer » sur la commande. |
| Une imprimante ne revient pas | Back-office, « Imprimantes », « Renvoyer ses tickets sur une autre », puis « Désactiver ». |
| La tablette est figée | N'importe quel téléphone ouvre `/tablette` et prend le relais. |
| Bandeau « Pause automatique » | La tablette n'a pas répondu pendant 3 minutes. « Reprendre les commandes ». |
| Le site ne répond plus | Feuille « Pannes », près de la tablette. |

## Un client mécontent

| Ce qu'il dit | Ce que je fais |
|---|---|
| « Il manque un plat », « c'est arrivé froid » | Back-office, « Commandes », ouvrir la commande, onglet « Réclamations », « Noter la réclamation ». |
| Je décide de rembourser | Onglet « Gestes », le montant ou « Tout ce qui reste », le motif, « Rembourser ». Possible une fois la commande prête, partie ou livrée. |
| Payée au comptoir | Rendre l'argent en espèces. Le site le note. |
| « Je n'ai rien reçu par e-mail » | Onglet « E-mails », « Renvoyer au client ». |
| Le remboursement a échoué | Alerte sur l'accueil. Rappeler le client, puis rembourser depuis Stripe ou en espèces. |
| Client absent à la livraison | La commande est close sans remboursement. Je décide au cas par cas. |

## Fermeture

1. Tablette, onglet « En cours ». Il ne reste rien à faire. Le comptoir suit sa consigne de fin de service.
2. Onglet « Terminées ». Une commande retirée sans paiement noté garde « Espèces » et « Carte ».
3. Back-office, « Clôture du jour ». Lire « Comptoir pas encore encaissé » puis « À vérifier ».
4. Compter la caisse. Écrire les espèces et le total du ticket du terminal.
5. « Clôturer le jour ». L'écran donne l'attendu, le compté et l'écart.
6. « Imprimer ». Une page A4.

Si une commande du jour change après la clôture, un bandeau le dit. Toucher « Reclôturer ».

## L'équipe

| Ce qui arrive | Ce que je fais |
|---|---|
| Un nouveau | « Équipe », « Ajouter quelqu'un ». Prénom, e-mail, accès. |
| Quelqu'un part | « Retirer ». Son accès est coupé tout de suite. |
| Un téléphone ou la tablette est perdu | « Déconnecter partout ». |
| Je livre moi-même ce soir | À venir : mon compte gérant ouvrira la page du livreur, sans second compte. En attendant, faire noter « Partie » puis « Livrée » sur la tablette. |
| Quelqu'un ne reçoit pas son code | Attendre 30 secondes, « Renvoyer un code », regarder les indésirables. |

## Chaque semaine

- « Rapports » pour les ventes et le panier moyen.
- « Export comptable » pour la période, puis « Télécharger le fichier CSV ».
- « Journal » pour retrouver qui a changé un prix ou un horaire.
- « Calendrier » pour les jours fermés à venir.
