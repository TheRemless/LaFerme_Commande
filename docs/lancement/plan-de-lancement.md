# Plan de lancement

Proposition du 12.11.2026, à valider par Jérémy. Date de lancement proposée : mardi 12 janvier 2027, jour de la réouverture après la fermeture annuelle (du 22.12.2026 au 11.01.2027 inclus). La bascule se fait la veille, lundi 11 janvier, un jour sans service. Si Jérémy choisit une autre date, toutes les semaines glissent d'autant.

Pourquoi pas avant Noël : il reste cinq semaines de service jusqu'au 19 décembre. La liste `docs/mise-en-ligne.md` compte encore des points qui dépendent de tiers (Stripe, relecture juridique, SCAV, imprimante). Un lancement début décembre serait suivi de trois semaines de fermeture, juste quand les flyers arrivent dans les boîtes.

Qui : J Jérémy, G Giuseppe, É l'équipe (comptoir, cuisine, livreurs), C Claude.

| Semaine | Qui fait quoi | Dépend de |
|---|---|---|
| Dès maintenant, jusqu'au 13.12 | J : tableau de la carte rempli (prix, plats commandables, poste, provenances), zones, frais et horaires validés dans le back-office, infos de l'entreprise, choix du domaine. J : comptes Stripe (TWINT), Resend, Supabase Pro avec projet de test, Netlify Pro. J : choix de l'offre de première commande (`offre-premiere-commande.md`). G : allergènes de chaque plat, « fait maison » oui ou non pour le tiramisù et la terrine. J : achat de la première imprimante et de la tablette. C : code promo par une autre session une fois l'offre choisie | `mise-en-ligne.md` phase 1. Sans prix ni allergènes validés, le build de production refuse de partir |
| S-4, du 14 au 19.12 | J : relecture des pages légales par un professionnel, annonce au SCAV. É avec C : recette en service fictif le lundi 14.12 (jour sans service), sur la préversion branchée sur le projet de test. J : vérifier qu'il a l'accès propriétaire à la fiche Google (`fiche-google.md`, étape 1). J : relire le flyer et l'autocollant, fixer l'adresse du QR, valider le bon à tirer | Recette : imprimante branchée, Stripe test, Resend. Flyer : domaine, offre, communes et horaires validés |
| S-3, du 21 au 27.12 (fermeture dès le 22) | J : commander l'impression des flyers et des autocollants, livraison avant le 4.01. C : corrections notées pendant la recette | Bon à tirer validé en S-4 |
| S-2, du 28.12 au 3.01 | Fermeture. C : derniers correctifs, liste de bascule prête | Rien |
| S-1, du 4 au 10.01 | J ou distributeur : flyers dans les boîtes du 5 au 8.01, zone 1 d'abord (Onex, Lancy, Confignon, Bernex). J : fiche Google préparée (catégories, attributs, horaires de livraison, photos), sans lien de commande tant que le site n'est pas en ligne. Lundi 11.01, bascule. J donne l'accord écrit, vide la base de test, saisit les clés live. C : déploiement, contrôles d'après bascule. J : vraie commande TWINT remboursée | `mise-en-ligne.md` phases 3 et 4. DNS du domaine |
| S0, du 12 au 16.01 | C : site déclaré dans Search Console, plan du site soumis. J : lien « Commander » de la fiche Google vers le site, premier post Google. É : un autocollant sur chaque boîte et chaque sac qui sort, une phrase au téléphone pour dire que le site existe. G : surveille la tablette et le temps d'acceptation. C : relève chaque jour les alertes et les commandes | Site en ligne |
| S+1, du 19 au 23.01 | J et C : premier point en 15 minutes (commandes par jour, livraison ou retrait, codes utilisés, gênes de l'équipe). J : demander un avis Google aux clients contents, sans contrepartie | Rien |
| S+2, du 26 au 30.01 | J : deuxième vague de flyers en zone 2 (Carouge, Plan-les-Ouates, 1205, 1219) si la cuisine et le livreur suivent. C : ajustements des créneaux et de la capacité | Chiffres de S0 et S+1 |
| S+3, du 2 au 6.02 | J : photos ajoutées à la fiche Google, deuxième post. G : liste des plats qui manquent de photo (`docs/audits/liste-photos.md`) pour un shooting | Rien |
| S+4, du 9 au 13.02 | J et C : bilan d'un mois. Commandes du site contre Uber Eats, frais Stripe, crédits Netlify, livraison à midi (seuil de 3 par jour proposé), zone 3 ou non, fin ou prolongation de l'offre, suite d'Uber Eats | Un mois de données |

## Ce qui bloque le calendrier

1. Prix et allergènes validés (le build de production refuse sans).
2. Domaine choisi et accès DNS (le QR des flyers en dépend : rien n'est imprimé avant).
3. Stripe avec TWINT activé et Resend branché (pas de paiement ni de code de connexion sans eux).
4. Imprimante achetée et testée avant la recette du 14.12.
5. Offre choisie avant le bon à tirer (S-4).

Si un de ces points manque le 14 décembre, la recette glisse au lundi 11 janvier et le lancement au mardi 19 janvier, flyers distribués du 12 au 15.
