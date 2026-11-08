# Accessibilité (lot 8d, 8.11.2026)

Référence : WCAG 2.1 niveaux A et AA, plus la taille des cibles de WCAG 2.2.

## Contrôle automatique

`tests/e2e/accessibilite.spec.ts` passe axe-core 4.14.0 (règles `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sur chaque écran, en bureau et en mobile, à chaque `npm run test:e2e` :

- accueil, avec le retrait choisi ;
- carte, fiche d'un plat, panier, commande, suivi ;
- compte, pages légales ;
- tablette et back-office, connexion puis écrans connectés.

## Corrigé dans ce lot

| Problème | Critère | Correction |
|---|---|---|
| Description des plats et étapes du suivi en gris clair sur le béton : contraste de 4,24 | 1.4.3 | Texte en blanc sur le béton : 5,01 |
| Pas de moyen de passer l'en-tête et les catégories au clavier | 2.4.1 | Lien « Aller au contenu », visible au premier Tab |
| Ajout au panier silencieux pour un lecteur d'écran (la fiche se ferme) | 4.1.3 | Annonce « Dans le panier : Margherita. 3 articles en tout. » |
| Boutons « −5 » et « +5 » de la tablette nommés « Cinq minutes de moins » | 2.5.3 | Nom qui commence par le texte visible : « −5 minutes de préparation » |
| Logo, rappel du choix et liens « Modifier » de 24 à 35 px de haut | 2.5.8 | 44 px de haut au moins |
| Quantités du panier changées sans annonce | 4.1.3 | Nouvelle quantité annoncée (« Quantité : 4 ») |
| Page introuvable de Next.js, en anglais | 3.1.1 | Page en français, avec le retour à l'accueil et le numéro du restaurant |

## Vérifié à la main

- Clavier : tout se fait au clavier. La fiche d'un plat garde le focus tant qu'elle est ouverte, se ferme par Échap et rend le focus au plat.
- Focus visible partout (contour de 3 px).
- Largeur de 320 px (zoom à 400 %) : aucun défilement horizontal sur l'accueil, la carte, le panier, la commande, le compte, les CGV et la tablette.
- Choix livraison ou à emporter, onglets et ruptures annoncés comme boutons enfoncés ou non (`aria-pressed`).
- Aucune animation : rien à couper pour les personnes qui réduisent les mouvements.
- Seuls les liens placés dans une phrase (CGV, confidentialité) restent sous 44 px, ce que le critère 2.5.8 accepte.

## Pas vérifié

- Lecture complète avec VoiceOver sur un vrai iPhone. À faire pendant la recette en service fictif (`docs/mise-en-ligne.md`).
