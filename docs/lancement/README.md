# Lancement commercial

Documents préparés le 12.11.2026, aucun code du site modifié. Rien n'a été publié, aucun compte créé.

## Décisions attendues de Jérémy

Tant qu'elles manquent, les champs en jaune des supports restent à confirmer et rien ne part à l'impression.

| Décision | Où regarder | Ce qui en dépend |
|---|---|---|
| Offre de première commande (A 10 %, B livraison offerte, C CHF 10 dès CHF 40, ou aucune) | [offre-premiere-commande.md](offre-premiere-commande.md) | Code promo à coder par une autre session, texte du flyer et de l'autocollant, post Google « Offre » |
| Adresse du site (domaine principal ou sous-domaine de restaurantlaferme.ch) | [plan-de-lancement.md](plan-de-lancement.md), `docs/mise-en-ligne.md` | QR et adresse imprimés, lien de commande de la fiche Google, redirections du site Wix |
| Zones et horaires de livraison, validés dans le back-office | `docs/mise-en-ligne.md` phase 1 | Communes et horaires du flyer, horaires de livraison sur Google |
| Demande écrite au gestionnaire de compte Uber Eats avant tout flyer ou autocollant dans les sacs Uber | [uber-eats-vers-le-site.md](uber-eats-vers-le-site.md), six questions prêtes | Autocollant sur les commandes Uber |
| Tirage et mode de distribution (zone 1 seule ou toute la zone, Poste ou équipe) | [impression-distribution.md](impression-distribution.md) | Commande d'impression en S-3, dépôt à la Poste le 4.01 |

| Fichier | Contenu |
|---|---|
| [plan-de-lancement.md](plan-de-lancement.md) | Semaine par semaine, de S-4 à S+4, qui fait quoi |
| [referencement-local.md](referencement-local.md) | Recherches qui comptent, concurrents qui livrent eux-mêmes, actions |
| [fiche-google.md](fiche-google.md) | Réglages de la fiche Google pas à pas, textes prêts à coller |
| [supports/](supports/) | Flyer A5 recto verso et autocollant rond de 80 mm : maquettes HTML, PDF pour l'imprimeur, images |
| [offre-premiere-commande.md](offre-premiere-commande.md) | Trois offres chiffrées et le besoin de code promo |
| [uber-eats-vers-le-site.md](uber-eats-vers-le-site.md) | Ce que le contrat Uber Eats et le droit suisse permettent pour faire passer les clients au site |
| [impression-distribution.md](impression-distribution.md) | Prix d'impression et de distribution des flyers relevés en ligne |

## Supports imprimés

- Rendus : `supports/rendus/flyer-a5.pdf` (deux pages, 154 × 216 mm, fond perdu de 3 mm inclus), `supports/rendus/autocollant-80mm.pdf` (86 × 86 mm, découpe ronde de 80 mm au centre), et les images JPEG de chaque face.
- Les champs non validés (adresse du site, offre, code, communes, horaires) se règlent dans `supports/champs.js` et restent surlignés en jaune tant qu'ils commencent par « [ ».
- Pour refaire les PDF une fois les champs remplis, depuis la racine du dépôt : `node docs/lancement/supports/rendre.mjs`. Le domaine du QR peut aussi se passer en variable, chaque support gardant son `ref` : `SITE=https://… node docs/lancement/supports/rendre.mjs`.
- Textes et source de chaque fait : `supports/textes-supports.md`.
- Photos : shooting pro (`public/accueil.jpg`, `public/plats/margherita.jpg`), droits acquis. Logo : `public/logo-la-ferme.png`.
- À dire à l'imprimeur : fichier en RVB, il convertit en quadrichromie. Demander une épreuve papier avant le tirage complet et scanner le QR imprimé avec deux téléphones.
