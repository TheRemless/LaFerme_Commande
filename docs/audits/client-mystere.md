# Audit « client mystère »

Audit du 12.11.2026 (entre 2h et 3h30 à Genève), sur la préversion https://deploy-preview-18--boisterous-beijinho-c37e44.netlify.app (contenu de `main`, vraie base Supabase). Audit seulement : aucun code, aucune migration, aucun réglage touché. Ni tablette ni back-office ouverts, site jamais mis en pause.

Méthode : Playwright avec le Chrome du Mac, en mobile tactile 375 × 667 et 390 × 844, et en bureau 1440 × 900. L'heure de Genève est simulée par `?heure=` (surtout le mardi 10.11.2026 à 19h05). Neuf commandes de test, deux comptes (liste à la fin). Captures dans `docs/audits/captures-client/` (29 JPEG, 1,1 Mo).

Légende : **[vérifié]** reproduit sur la préversion, **[code]** lu dans le code sans reproduction, **[supposé]** déduit, non prouvé.

## Les 10 constats les plus importants

| # | Constat | Gravité | Effort |
|---|---|---|---|
| CM-01 | Adresse saisie à la main : « Dans notre zone » à l'accueil, puis refusée au paiement pour une simple abréviation (« Av. ») | bloquant avant lancement | moyen |
| CM-02 | Bouton « Payer » grisé sans raison visible sur mobile : l'explication est 500 px plus bas, dans le récapitulatif | bloquant avant lancement | petit |
| CM-03 | Livraison de 22h05 à 22h15 : « La cuisine est fermée… mercredi 11h45 » alors que le sélecteur propose ce soir 22h45 | important | petit |
| CM-04 | Après un paiement refusé ou un rechargement, prénom, nom, téléphone et e-mail sont effacés | important | petit |
| CM-05 | L'heure promise à l'accueil (« Chez vous vers 19h40 ») disparaît ensuite : ni au paiement, ni au suivi, ni dans l'e-mail | important | petit |
| CM-06 | Avant et pendant la fermeture annuelle : « Aucun créneau libre » sans parler de la fermeture, et impossible de commander pour le 12.01 même à J-4 | important | moyen |
| CM-07 | Suggestions d'adresse : le numéro tapé n'est pas en tête, le premier choix peut être un autre immeuble ou une autre commune | important | petit |
| CM-08 | Restaurant fermé (fermeture annuelle) : la carte laisse remplir le panier, puis « Choisissez une autre heure » alors qu'il n'y en a aucune | important | petit |
| CM-09 | Téléphone invalide : message global sans dire quel champ, aucun contrôle avant l'envoi | important | petit |
| CM-10 | Barre du panier : « Encore CHF 2.00 pour le minimum » à côté de « CHF 30.90 », le client lit qu'il a dépassé 30 | confort | petit |

## Ce qui marche bien

- **Contrôle de zone immédiat** [vérifié] : frais, minimum et heure d'arrivée s'affichent dès l'adresse choisie. Hors zone (Servette 1202, Florissant 1206, Versoix 1290) et hors canton (Nyon) : message clair avec un bouton « Commander à emporter ». Capture 01, 02.
- **Double clic sur Payer** [vérifié] : une seule requête envoyée, une seule commande (commande 1).
- **Deux onglets** [vérifié] : après la commande dans le premier onglet, le second affiche « Votre panier est vide ». Pas de doublon (commande 6).
- **Options** [vérifié] : pâtes obligatoires (bouton « Choisissez vos pâtes » inactif tant que rien n'est choisi), 5 suppléments au plus (le 6e est désactivé), retraits gratuits, note limitée à 80 caractères. Le HTML et les emoji de la note ressortent tels quels, sans être interprétés, au panier, au suivi et dans l'e-mail. Capture 06.
- **Règle des 21h30** [vérifié] : après 21h30, les plats hors pizzas sont grisés avec « Seulement les pizzas à cette heure », et l'accueil l'annonce. Capture 07.
- **Combien je paie** [vérifié] : le total est sur le bouton (« Payer CHF 55.90 »), frais de livraison et TVA séparés au panier, au paiement, au suivi et dans l'e-mail.
- **Hors ligne** [vérifié] : « Pas de connexion. Vérifiez le réseau et réessayez. », panier intact.
- **Paiement refusé** [vérifié] : retour sur la commande avec « Paiement annulé. Votre panier est toujours là. » (mais voir CM-04).
- **Commande à l'avance** [vérifié] : jusqu'au mardi suivant (J+7), dimanche et lundi proposent le mardi. Adresse, étage, code et instructions bien repris (commande 4).
- **Comptes** [vérifié] : code faux refusé avec délai croissant, renvoi bloqué 30 s, ancien code annulé après un renvoi, bon code accepté. Un code entré après 10 min 30 est refusé (« Code incorrect ou expiré »). Commande rangée dans le compte, adresse enregistrée. Export JSON complet (compte, adresses, commandes, sessions, journal). Suppression protégée par une case, la commande reste suivable après.
- **Suivi** [vérifié] : le lien marche dans un autre navigateur sans stockage, la page est `noindex` et `no-store`. Elle se recharge seule toutes les 20 s [code].
- **Plat retiré de la carte** [vérifié] : ligne marquée « Ce plat n'est plus à la carte. », comptée à 0, paiement bloqué (voir CM-02 et CM-20 pour l'affichage).

## Clarté pour un client pressé

| Question du client | Réponse du site | Hésitations notées |
|---|---|---|
| Combien je paie ? | Toujours visible : barre du panier, bouton Payer, suivi, e-mail | Minimum : la barre affiche le total avec les frais à côté du montant manquant (CM-10). « 2.90 » et « 30.– » sans « CHF » dans le bloc de zone (CM-25) |
| Quand je suis livré ? | Accueil : « Chez vous vers 19h40 ». Ensuite seulement « Dès que possible » | Plus aucune heure au paiement, au suivi et dans l'e-mail (CM-05). Message « cuisine fermée » faux de 22h05 à 22h15 (CM-03) |
| Pourquoi je ne peux pas payer ? | Bouton gris | La raison est sous le récapitulatif, hors écran (CM-02) |
| Que faire en cas de problème ? | 022 792 16 89 au suivi, dans l'e-mail, en pied de page, dans le message d'adresse introuvable | Pas d'e-mail du restaurant (déjà dans `docs/mise-en-ligne.md`, phase 1). Rien n'explique quoi faire si la commande n'est pas acceptée |

## Constats détaillés

### CM-01. Adresse saisie à la main acceptée à l'accueil, refusée au paiement

- **Gravité** : bloquant avant lancement. **Statut** : [vérifié]
- **Où** : `/` puis `/commande` ; `src/components/accueil/ChoixCommande.tsx:133-158`, `src/lib/zone-serveur.ts:24-40`, `src/lib/adresse-serveur.ts:36-55`.
- **Reproduire** : `/?heure=2026-11-10T19:05`, taper « Av. du Gros-Chêne 20 », « Mon adresse n'apparaît pas », Rue « Av. du Gros-Chêne », Numéro 20, NPA 1213, Localité Onex. L'accueil affiche « Dans notre zone de livraison », 2.90, 30.–, 19h40. Remplir le panier, les coordonnées, cliquer Payer.
- **Attendu** : la même réponse à l'accueil et au paiement. **Observé** : au paiement seulement, « Nous ne trouvons pas cette adresse. Vérifiez-la, ou appelez-nous au 022 792 16 89. » Même chose avec un NPA faux (« Rue de la Servette 50, 1213 Onex », vraie adresse en 1202). Seule l'orthographe exacte du registre passe (« Avenue du Gros-Chêne », commande 8). La saisie à la main sert justement aux adresses que la recherche ne trouve pas : ce chemin aboutit presque toujours à un refus, après tout le panier. Captures 03, 04.
- **Correction** : à l'accueil, contrôler l'adresse manuelle comme au paiement (`zoneServeur(..., true)` dans `/api/adresse`) et afficher tout de suite « Adresse introuvable » avec les suggestions les plus proches. Accepter les abréviations courantes (av., ch., rte, bd, pl.). Si l'adresse reste introuvable, proposer l'appel ou le retrait avant la carte.
- **Effort** : moyen.

### CM-02. Bouton Payer grisé sans raison visible sur mobile

- **Gravité** : bloquant avant lancement. **Statut** : [vérifié]
- **Où** : `/commande`, `src/components/commande/PageCommande.tsx:225-240` (seule l'erreur d'envoi est près du bouton), messages dans `<aside className="commande-recap">`.
- **Reproduire** : en 375 px, livraison au Lignon (minimum 40.–), Margherita et Funghi (38.–), aller sur `/commande`. Ou panier mixte choisi à 21h25 puis heure passée à 21h31. Ou un plat retiré de la carte.
- **Attendu** : la raison à côté du bouton. **Observé** : bouton gris à y = 1251 px, message « Encore CHF 2.00 pour le minimum de livraison (40.–). » à y = 1748 px, sous le récapitulatif. Le client voit un bouton mort après avoir rempli ses coordonnées. Même schéma pour « Après 21h30, on ne prend plus que les pizzas… » et pour la fermeture. Captures 10, 11.
- **Correction** : répéter le message bloquant juste au-dessus du bouton (ou dans le bouton : « Encore CHF 2.00 pour commander »), avec le lien d'action (« Ajouter un plat », « Changer l'heure »).
- **Effort** : petit.

### CM-03. Livraison entre 22h05 et 22h15 : message « fermée » contredit par le choix proposé

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/` en livraison, `ChoixCommande.tsx` (message de `etatService` quand « dès que possible » n'est plus possible).
- **Reproduire** : `/?heure=2026-11-10T22:14`, livraison Avenue du Gros-Chêne 20.
- **Attendu** : « Ce soir, seulement les pizzas, livrées vers 22h45 » ou équivalent. **Observé** : « La cuisine est fermée en ce moment. Vous pouvez déjà commander pour le mercredi 11 novembre, à partir de 11h45. » et juste dessous Jour « mardi 10 novembre », Heure « 22h45, pizzas seulement ». À 22h05, « Dès que possible, vers 22h40 » s'affiche bien. Capture 21.
- **Correction** : quand il reste un créneau le jour même, ne pas dire « fermée » ; le texte doit suivre le premier créneau réellement proposé.
- **Effort** : petit.

### CM-04. Coordonnées effacées après un refus de paiement ou un rechargement

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/commande?annule=1`, `PageCommande.tsx:36-41` (état React seulement).
- **Reproduire** : remplir les coordonnées, Payer, « Simuler un refus de la banque ». Ou recharger la page.
- **Attendu** : les champs restent remplis. **Observé** : panier gardé mais prénom, nom, téléphone et e-mail vides. Un client dont TWINT a échoué doit tout retaper. Capture 16.
- **Correction** : garder les coordonnées en `sessionStorage` (pas en `localStorage` si l'appareil est partagé), remplies au retour.
- **Effort** : petit.

### CM-05. L'heure annoncée disparaît après l'accueil

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/commande` (« Dès que possible »), `/suivi/…` (« Demandée dès que possible. Le restaurant confirme l'heure en acceptant la commande. »), e-mail de confirmation (« Livraison dès que possible »).
- **Reproduire** : commande 1, accueil à 19h05 : « Chez vous vers 19h40 ».
- **Attendu** : « Dès que possible, vers 19h40 » rappelé au paiement, puis « Heure prévue vers 19h40, confirmée à l'acceptation » au suivi et dans l'e-mail. **Observé** : plus aucune heure tant que le restaurant n'a pas accepté. Captures 14, 28, 29.
- **Correction** : afficher l'estimation calculée à l'accueil (ou recalculée) partout jusqu'à l'acceptation.
- **Effort** : petit.

### CM-06. Fermeture annuelle mal expliquée, pas de commande pour la réouverture

- **Gravité** : important. **Statut** : [vérifié] pour l'affichage, [code] pour la cause.
- **Où** : `/` ; `src/lib/service.ts:218-225` (un jour fermé donne l'état `fermeture` sans créneau).
- **Reproduire** : `/?heure=2026-12-19T22:30` (samedi soir avant la fermeture) puis `/?heure=2027-01-08T12:00`.
- **Attendu** : le 19.12, « Fermé du 22 décembre au 11 janvier, on rouvre le mardi 12 janvier ». Le 08.01, créneaux du 12.01 proposés (J+4, dans la limite des 7 jours, comme pour un dimanche). **Observé** : le 19.12, « Aucun créneau libre dans les 7 prochains jours. Une question ? 022 792 16 89. » Le 08.01, « On rouvre le mardi 12 janvier. » sans aucun créneau. Captures 18, 19.
- **Correction** : annoncer la fermeture dès qu'elle couvre la fenêtre de 7 jours. Pendant la fermeture, proposer les créneaux d'après la réouverture qui tombent dans la fenêtre. À faire trancher par Jérémy pour le second point.
- **Effort** : moyen.

### CM-07. Suggestions d'adresse : le numéro tapé n'est pas en premier

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/`, liste `.suggestions` (ordre de geo.admin.ch repris tel quel).
- **Reproduire** : taper « Rue de Rive 10 Nyon » : premier choix « Rue de Rive 22d ». Taper « Route de Chancy 400 » : premier choix « Route de Chancy 500, 1284 Chancy » (hors zone, alors que le client pense à Bernex).
- **Attendu** : le numéro exact en tête, ou rien de sélectionné tant que le numéro ne correspond pas. **Observé** : un client pressé qui touche le premier choix enregistre un autre immeuble. En zone, le livreur irait à la mauvaise porte.
- **Correction** : trier les suggestions par correspondance du numéro tapé, signaler « numéro différent de votre saisie ».
- **Effort** : petit.

### CM-08. Fermeture : panier remplissable puis « choisissez une autre heure »

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/carte` puis `/commande` ; `src/app/api/commandes/route.ts:75`.
- **Reproduire** : `/?heure=2026-12-23T12:00`, À emporter, Voir la carte, ajouter une Margherita, `/commande`.
- **Attendu** : sur la carte, plats non ajoutables ou bandeau « Commandes fermées jusqu'au 12 janvier ». **Observé** : l'en-tête dit « commande en ligne fermée » mais les plats s'ajoutent ; au paiement, « Ce moment n'est plus disponible. Choisissez une autre heure. Changer l'heure », alors qu'aucune heure n'existe. Capture 20.
- **Correction** : bandeau clair sur la carte et désactiver « Ajouter » quand `quand` vaut `aucun`, ou garder la carte en consultation avec le message de fermeture.
- **Effort** : petit.

### CM-09. Téléphone invalide : message global, sans contrôle préalable

- **Gravité** : important. **Statut** : [vérifié]
- **Où** : `/commande`, champ `type="tel"` sans motif.
- **Reproduire** : téléphone « abc », Payer.
- **Attendu** : le champ téléphone signalé avant l'envoi (« Numéro suisse ou international, par exemple 079 123 45 67 »). **Observé** : la requête part, retour 422 et « Vérifiez vos coordonnées : prénom, nom, téléphone et e-mail. » sans dire lequel. Capture 12.
- **Correction** : contrôle du téléphone dans le navigateur, message par champ.
- **Effort** : petit.

### CM-10. Minimum : montant manquant à côté du total frais compris

- **Gravité** : confort. **Statut** : [vérifié]
- **Où** : barre du panier sur `/carte`.
- **Reproduire** : livraison Onex (minimum 30.–), une Margherita à 28.–.
- **Attendu** : « Encore CHF 2.00 de plats pour la livraison » avec le sous-total. **Observé** : « Encore CHF 2.00 pour le minimum ¦ CHF 30.90 ». Le client voit 30.90 et ne comprend pas ce qui manque. Capture 08.
- **Correction** : afficher le sous-total des plats dans la barre tant que le minimum manque, ou préciser « hors livraison ».
- **Effort** : petit.

### CM-11. Retour arrière après paiement : « Page introuvable »

- **Gravité** : confort (doublure seulement). **Statut** : [vérifié] avec la doublure, [supposé] avec Stripe.
- **Où** : `/paiement-test/<id>` après paiement.
- **Reproduire** : commande 1 payée, bouton retour du navigateur.
- **Observé** : « Page introuvable » (404) puis, au second retour, « Votre panier est vide ». Rien n'est cassé mais le client s'inquiète. Avec Stripe Checkout, le retour mène à la page Stripe déjà payée : à revérifier quand la clé de test sera là. Capture 15.
- **Correction** : la doublure peut renvoyer vers le suivi si la commande est déjà payée ; refaire le test avec Stripe test.
- **Effort** : petit.

### CM-12. NPA 1219 Châtelaine accepté en zone 2 sans être dans la liste

- **Gravité** : confort (décision). **Statut** : [vérifié]
- **Où** : `src/lib/service.ts:54-60` (repli sur le NPA quand il ne désigne qu'une zone).
- **Reproduire** : « Avenue de Châtelaine 81 » → zone 2, 4.90, minimum 40.–.
- **Observé** : la table ne liste que Le Lignon et Aïre pour 1219, mais toute localité en 1219 passe. Même logique pour 1205 et 1213. Peut-être voulu ; à faire valider par Jérémy avec la liste des zones.
- **Effort** : petit.

### CM-13. NPA à 3 chiffres : aucun message

- **Gravité** : confort. **Statut** : [vérifié]
- **Où** : saisie à la main, `ChoixCommande.tsx:127-131`.
- **Reproduire** : NPA « 121 ».
- **Observé** : ni verdict ni aide, « Voir la carte » reste inactif. **Correction** : « Le NPA a quatre chiffres ».
- **Effort** : petit.

### CM-14. Note pour la cuisine coupée sans prévenir

- **Gravité** : confort. **Statut** : [vérifié]
- **Où** : fiche plat, `maxLength={80}`.
- **Observé** : une note de 91 caractères est coupée à 80 sans compteur ; un emoji compte pour deux. **Correction** : compteur « 72 / 80 ».
- **Effort** : petit.

### CM-15. Panier de plus de 24 h vidé sans explication

- **Gravité** : confort. **Statut** : [vérifié] (date du panier reculée de 25 h dans le stockage local).
- **Observé** : `/panier` affiche « Votre panier est vide. » sans dire pourquoi. Sous 24 h, le panier survit au rechargement et à un nouvel onglet [vérifié] ; la fermeture complète du navigateur n'a pas été testée, le stockage local la survit normalement [supposé].
- **Correction** : « Votre panier d'hier a expiré » une fois.
- **Effort** : petit.

### CM-16. Renvoi de code trop tôt : « Trop d'essais »

- **Gravité** : confort. **Statut** : [vérifié]
- **Où** : `/compte`, « Renvoyer un code » dans les 30 s.
- **Observé** : « Trop d'essais. Réessayez dans 27 secondes. » Le client n'a fait aucun essai. **Correction** : « Un nouveau code pourra partir dans 27 s », compte à rebours sur le lien.
- **Effort** : petit.

### CM-17. « Créer mon compte » cochée : le code ne part pas tout seul

- **Gravité** : confort. **Statut** : [vérifié]
- **Où** : `/commande` puis `/suivi/…` (commande 9).
- **Observé** : la case dit « On vous envoie un code pour le confirmer », mais au suivi il faut encore toucher « Recevoir un code ». Ensuite tout marche (« Compte créé. Cette commande est dans votre compte »). Capture 25.
- **Correction** : envoyer le code à l'arrivée sur le suivi, ou changer le texte de la case.
- **Effort** : petit.

### CM-18. Suppression du compte sans confirmation à l'écran

- **Gravité** : confort. **Statut** : [vérifié]
- **Observé** : après « Supprimer définitivement », retour direct au formulaire « Votre compte » sans message. Capture 26.
- **Correction** : « Votre compte est supprimé. Vos commandes passées restent chez le restaurant pour la comptabilité. »
- **Effort** : petit.

### CM-19. « Recommander » sans message, plats non disponibles bloqués au paiement seulement

- **Gravité** : confort. **Statut** : [vérifié] pour l'heure, non testé pour une rupture.
- **Reproduire** : compte test-cm.case, choix « à emporter » enregistré à 21h35, « Recommander la même chose » sur Peppino + Tagliatelle La Ferme.
- **Observé** : retour en haut de la carte sans message ; les tagliatelles entrent dans le panier et le blocage n'apparaît qu'au paiement, sous le récapitulatif (CM-02). **Correction** : message « 2 plats remis dans le panier », et contrôle de l'heure au moment de recommander.
- **Effort** : petit.

### CM-20. Ligne d'un plat retiré : identifiant brut

- **Gravité** : confort. **Statut** : [vérifié] avec un identifiant inconnu (simulation d'un plat retiré).
- **Observé** : la ligne s'appelle « plat-retire-test-cm » à « 0.– ». Le nom du plat est perdu une fois retiré de la carte. Capture 22. Un plat en rupture garde son nom et affiche son motif [code, `src/lib/panier.ts:61-64`].
- **Correction** : garder le nom dans le panier local pour l'afficher, et un bouton « Retirer ».
- **Effort** : petit.

### CM-21. Réseau très lent : premier tap perdu

- **Gravité** : confort. **Statut** : [vérifié]
- **Mesure** : émulation 400 kbit/s, 400 ms. Boutons « Livraison » et « À emporter » visibles à 1,2 s, inactifs jusqu'à environ 9,3 s (premier tap sans effet). En 3G normale (1,6 Mbit/s, 150 ms), réactifs à 0,2 s. Capture 27.
- **Correction** : état visuel « chargement » tant que la page n'est pas prête, ou boutons en simples liens qui marchent sans JavaScript.
- **Effort** : moyen.

### CM-22. Noms de plats différents entre carte, suivi et e-mail

- **Gravité** : confort. **Statut** : [vérifié]
- **Observé** : « Margherita » sur la carte, « Pizza Margherita » au suivi et dans l'e-mail ; « Peppino » contre « Pizza peppino » (minuscule). **Correction** : un seul nom affiché.
- **Effort** : petit.

### CM-23. « − » à 1 supprime la ligne sans retour possible

- **Gravité** : confort. **Statut** : [vérifié]
- **Observé** : au panier, « − » sur une Margherita à 5 suppléments et une note la supprime d'un coup. **Correction** : « Annuler » pendant quelques secondes, ou icône poubelle distincte.
- **Effort** : petit.

### CM-24. Pas de recherche ni de plats populaires sur la carte

- **Gravité** : confort. **Statut** : [vérifié] (aucun champ de recherche, aucune mention « populaire » dans `src/components` et `src/lib`).
- **Observé** : `docs/PROMPT.md` §7 demande « recherche, plats populaires en tête ». 80 plats sur une seule page de 12 000 px en 375 px. **Correction** : à trancher avec Jérémy (la barre de catégories collante aide déjà).
- **Effort** : moyen.

### CM-25. Montants sans « CHF » dans le bloc de zone

- **Gravité** : confort. **Statut** : [vérifié]
- **Observé** : « Livraison 2.90, Minimum 30.– » ; partout ailleurs « CHF 2.90 ». Capture 01.
- **Effort** : petit.

### CM-26. Accueil mobile : « Voir la carte » sous la ligne de flottaison

- **Gravité** : confort. **Statut** : [vérifié] en 390 × 844.
- **Observé** : la photo d'en-tête et le bandeau de préversion poussent le champ d'adresse au bas de l'écran et le bouton dessous. Le bandeau disparaîtra en production ; la photo reste.
- **Effort** : petit.

## Déjà couvert ailleurs, non compté

- « Lardons : provenance à compléter » et « Allergènes : demandez-nous » s'affichent aux clients : bloqué par la vue `plats_bloquants` (`docs/mise-en-ligne.md`, phase 1).
- Messages de validation du navigateur en anglais (« Please fill in this field. ») : effet du Chrome sans interface utilisé pour le test, un téléphone en français les affiche en français [supposé].
- L'heure des courriels de test est affichée en UTC (00:58 pour 01:58 à Genève) : page de préversion seulement.

## Non testé, et pourquoi

| Cas | Raison | Ce que dit le code |
|---|---|---|
| Plat mis en rupture entre l'ajout et le paiement | Demande le back-office ou la tablette, hors de cet audit | Le serveur refuse avec « <plat> : <motif> » (`src/app/api/commandes/route.ts:63-64`). Carte en cache 60 s, vidée par le back-office et la tablette (`src/lib/catalogue.ts:42-46`) : pas vérifié sur Netlify [supposé] |
| Lien de suivi rouvert « le lendemain » | Le serveur ne simule pas l'heure du suivi | Rouvert dans un autre navigateur : marche. Aucune expiration du jeton dans le code |
| Rechargement pendant l'envoi de la commande | Réponse retardée par Playwright, la requête n'est pas arrivée au serveur : non concluant | Même clé d'idempotence par onglet tant que le contenu ne change pas (`PageCommande.tsx:15-26`) |
| Vrai Stripe (TWINT, carte) | Pas de clé de test sur la préversion | — |
| États acceptée, en route, refus avec remboursement | Demandent la tablette | — |

## Données de test créées (à vider avant la mise en ligne)

Toutes le 12.11.2026 entre 1h58 et 3h15 (heure de Genève), heure simulée le 10.11.2026. Nom « TEST-CM … », e-mails en `@laferme.test` : aucun e-mail réel n'est parti.

| N° | Client | E-mail | Mode, paiement | Montant | État |
|---|---|---|---|---|---|
| 1 | TEST-CM Livraison Invité | test-cm.invite@laferme.test | livraison Onex, en ligne (doublure) | 55.90 | payée |
| 2 | TEST-CM Retrait Comptoir | test-cm.retrait@laferme.test | retrait, comptoir | 50.00 | à encaisser |
| 3 | TEST-CM Avance J+7 | TEST-CM.Avance@LaFerme.test | livraison Plan-les-Ouates, 17.11 19h00 | 54.90 | paiement refusé |
| 4 | TEST-CM Avance J+7 | test-cm.avance@laferme.test | idem, second essai | 54.90 | payée |
| 5 | TEST-CM Compte Livraison | test-cm.compte@laferme.test | livraison Onex, en ligne, connecté | 35.90 | payée |
| 6 | TEST-CM Deux Onglets | test-cm.onglets@laferme.test | retrait, comptoir | 20.00 | à encaisser |
| 7 | TEST-CM Hors Ligne | test-cm.onglets@laferme.test | retrait, en ligne | 21.00 | payée |
| 8 | TEST-CM Manuel exacte | test-cm.manuel@laferme.test | livraison Onex (saisie à la main) | 36.00 | paiement refusé |
| 9 | TEST-CM Case Compte | test-cm.case@laferme.test | retrait, en ligne, case « créer mon compte » | 56.00 | payée, détachée du compte supprimé |

Comptes :

- `test-cm.compte@laferme.test` : existe, prénom TEST-CM, une adresse (Avenue du Gros-Chêne 20, Onex), commande 5. Codes envoyés : 3 entre 2h04 et 2h08 (plus une demande refusée à 2h06 par la limite d'une minute, attendu).
- `test-cm.case@laferme.test` : créé depuis le suivi de la commande 9, exporté puis supprimé. Codes demandés : 2.

Requêtes `POST /api/adresse` et essais refusés avant création (adresse introuvable, minimum, heure) : rien d'enregistré.
