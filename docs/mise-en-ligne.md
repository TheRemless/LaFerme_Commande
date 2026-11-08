# Mise en ligne

Liste de contrôle à suivre dans l'ordre. Aucune mise en production sans l'accord écrit de Jérémy. La liste complète (prix, Stripe, Resend, textes légaux, nettoyage de la base, recette) arrive avec la dernière PR du lot 8. Cette première partie fixe l'hébergement, décidé le 8.11.2026.

## Hébergement : Netlify Pro et fonctions à Francfort

Décision de Jérémy du 8.11.2026 : « Oui, Pro au lancement ». Chiffres et sources dans `docs/performance.md`.

- [ ] Jérémy : passer le projet Netlify au plan Pro (20 $ par mois pour l'équipe, prix relevé le 8.11.2026 sur netlify.com/pricing).
- [ ] Jérémy : régler la région des fonctions sur Francfort.
  1. Sur app.netlify.com, ouvrir le projet boisterous-beijinho-c37e44.
  2. Project configuration, puis Cloud compute, puis Functions, puis Region.
  3. Configure, choisir Frankfurt (`fra`), puis Save.
  4. Redéployer : Deploys, puis Trigger deploy, puis Deploy project. Les anciens déploiements gardent l'ancienne région.
  5. Prévenir Claude.
- [ ] Claude : ouvrir `/api/diagnostic/latence` sur une préversion. Attendu : région `eu-central-1` et des lectures autour de 30 ms (350 ms aujourd'hui depuis l'Ohio).
- [ ] Claude : une fois Francfort vérifié, retirer de la déclaration de confidentialité (`src/lib/legal/confidentialite.ts`, sous-traitants) la mention « Région de calcul des fonctions : États-Unis (Ohio) aujourd'hui » et indiquer Francfort. Netlify, Inc. reste une société américaine : la phrase sur le Swiss-U.S. Data Privacy Framework reste.

## Référencement, une fois l'adresse définitive en ligne

- [ ] Claude : passer l'accueil au test des résultats enrichis de Google (search.google.com/test/rich-results). Attendu : un `Restaurant` sans erreur.
- [ ] Jérémy : déclarer le site dans Google Search Console (propriété du domaine), puis y soumettre `/sitemap.xml`. Claude explique chaque clic.
- [ ] Claude : vérifier que `/robots.txt` ouvre l'accueil, la carte et les pages légales. Le plan du site doit les lister.
