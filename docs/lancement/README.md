# Lancement commercial

Documents préparés le 12.11.2026, aucun code du site modifié. Rien n'a été publié, aucun compte créé.

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
