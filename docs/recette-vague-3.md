# Recette en service fictif : nouveautés de la vague 3

À jouer pendant la phase 3 de [mise-en-ligne.md](mise-en-ligne.md), en plus de sa liste, sur la préversion finale branchée sur le projet de test, Stripe en mode test, hors des heures de service. Chaque ligne est une scène courte : on la joue, on coche, on note ce qui gêne.

Préparé par la session qualité le 13.11.2026, à compléter à la passe finale avec ce qui sera arrivé d'ici là.

## Avant de commencer

- [ ] Claude : `npm run donnees:rush` puis `npm run charge:vendredi` en local sur la version finale. Aucune erreur, mêmes ordres de grandeur que [charge.md](charge.md).
- [ ] Claude : suite e2e complète sur le jeu de rush (`BASE_LOCALE_INSTANTANE=… npx playwright test`). Référence du 13.11 : 395 sur 397, les deux échecs étant des collisions de noms dans les tests, corrigées depuis.
- [ ] Jérémy : les fonctions construites mais désactivées restent éteintes pour la recette, sauf celles qu'il décide d'allumer (liste en bas de page).

## Commande du client

- [ ] Allergie notée pour toute la commande : elle sort en tête des deux tickets, s'affiche sur la tablette et dans le suivi (#71, #74, #143).
- [ ] Commande pour quelqu'un d'autre : le nom et le téléphone de la personne qui reçoit sont sur le ticket et pour le livreur (#84).
- [ ] Heure annoncée en fourchette (« entre 19h35 et 19h50 ») à l'accueil, au paiement, dans l'e-mail et le suivi : la même partout (#103, #143).
- [ ] Heure promise réaliste : avec dix commandes en cours, l'heure proposée recule (#67).
- [ ] Ligne du panier modifiée sans la retirer, options cochées d'avance par le restaurant (#76, #91, #137).
- [ ] Plat indisponible grisé avec sa raison, filtre « Végétarien » (#89, #142).
- [ ] Zone fermée jusqu'à une heure : le client lit « La livraison reprend à 21h00 dans votre quartier » (#95).
- [ ] Pause posée pendant que le client est sur la page de paiement : c'est annoncé avant « Payer » (#136).
- [ ] Client connecté : « reprendre ma dernière commande » en un tap, historique par pages, consignes d'une adresse enregistrée (#108, #110, #116).
- [ ] Commande passée en invité puis compte créé avec le même e-mail : l'historique la retrouve (#81).
- [ ] Suivi : signaler un problème au restaurant, le voir arriver au back-office (#122, #139).

## Tablette en rush

- [ ] Vingt commandes en cours : le tableau trie par urgence, le retard se lit à un mètre, la recherche par numéro, nom ou téléphone répond (#69, #97).
- [ ] Une commande d'un autre jour (refus pas encore remboursé) porte sa date sous le numéro : pas de confusion avec celle du jour qui a le même numéro (#163).
- [ ] Encaissement au comptoir en espèces puis par carte (#115).
- [ ] Coup de feu lancé en deux gestes, puis fin automatique à l'heure choisie : retard et capacité reviennent (#59, #148).
- [ ] Tablette laissée calme quatre minutes en service : pas de pause automatique (la relecture sans changement garde la tablette « vivante », #146).
- [ ] Commande modifiée après l'acceptation (#65), puis réimpression d'un seul poste (#90).

## Back-office

- [ ] Accueil : à régler, commandes du moment, service comparé à la semaine passée (#117).
- [ ] Recherche ⌘K : une commande par le nom du client, un plat, une rubrique (#121).
- [ ] Commandes : liste filtrée, fiche, changer l'heure, annuler et rembourser, renvoyer l'e-mail (#90, #125).
- [ ] Clients et réclamations : une réclamation ouverte puis close, note interne (#87, #139).
- [ ] Carte : prix en lot, copie d'un plat, rupture planifiée, groupes d'options (#82, #85, #119, #128).
- [ ] Livreurs : semaine type, absence, renfort, livraisons par livreur (#88, #123).
- [ ] Calendrier : un jour férié proposé, accepté, vu par le client (#104).
- [ ] Imprimantes : dernier ticket, tickets en attente, échecs du jour (#107).
- [ ] Clôture du jour (rapport Z) puis export pour la fiduciaire : les montants correspondent aux commandes du jour, remboursements compris (#83, #86).
- [ ] Journal : chaque geste de la recette y figure, avec son auteur (#106).
- [ ] Équipe : déconnecter un seul appareil d'un membre (#141).

## Argent et pannes (Stripe en mode test)

- [ ] Remboursement après coup dont la réponse de Stripe est coupée (couper le réseau du poste juste après « Rembourser »), puis relance : un seul remboursement dans Stripe (#129).
- [ ] Paiement par carte de test, onglet fermé avant le retour sur le site, webhook désactivé dans Stripe le temps de l'essai : la commande arrive sur la tablette en moins de cinq minutes (#149).
- [ ] Remboursement TWINT en attente, puis « succeeded » : la ligne passe « faite » par le webhook.
- [ ] Quota d'e-mails : seuil d'alerte atteint en baissant le plafond, l'alerte arrive (#68).
- [ ] Jouer en plus trois pages de [pannes.md](pannes.md) ajoutées en vague 3 : commande payée qui n'arrive pas, e-mails qui ne partent plus (livreur sans connexion), adresses fédérales en panne (« Fermer la livraison »).

## Sur la vraie infrastructure (Netlify Pro, Supabase Pro)

Mesures que le local ne donne pas ([charge.md](charge.md), « À mesurer ») :

- [ ] Temps de `/api/tablette/file` et du suivi entre Netlify et Supabase Zurich, région des fonctions Netlify.
- [ ] Délai du signal Realtime entre une commande payée et la tablette.
- [ ] Bande passante d'une soirée : relectures de la tablette (204 sans corps quand rien n'a changé) et suivis clients.

## Construit mais désactivé : à décider par Jérémy avant la recette

Annulation par le client (#70, #122), codes promo (#92, #113, #133), plat offert en geste commercial (#87), rôle « responsable de service » (#131), plafond global des codes de l'équipe (#109), plats les plus commandés et suggestion au panier (#112), couverts et prénom par ligne (#118), recréer une commande au téléphone et adresse dans une autre zone (#98), menus et formules (#153), coup de feu par l'équipe (#148). Chacune allumée se joue en recette comme les autres.
