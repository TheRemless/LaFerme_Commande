# Audit design, « l'œil du designer »

Audit du 12.11.2026 sur `main` (commit `d95375f`). Aucun code modifié. Terrain : instance locale de production (`BASE_LOCALE=1`, port 3104, base embarquée, doublures Stripe et e-mail) pour tous les écrans et tous les états, en 375 × 812 (téléphone, rendu ×2), 1024 × 768 (tablette) et 1440 × 900 (bureau). La preview Netlify n'a pas été utilisée. Même code et la base locale permet de provoquer les états (fermé, hors zone, commande acceptée) sans écrire dans la vraie base partagée avec les autres audits.

Captures : `docs/audits/captures-design/` (40 JPEG, 3,1 Mo). Préfixes `m-` téléphone, `t-` tablette 1024, `b-` bureau 1440, `tab-` tablette du restaurant, `bo-` back-office, `cmp-` maquette Béton à gauche et rendu actuel à droite. Les cadres bleus portent le numéro du constat.

Références lues avant l'audit : `CLAUDE.md`, `docs/PROMPT.md` §7 et §8, `docs/textes-publics.md`, `docs/recherche/benchmark-ux-fonctions.md` §5, maquettes `maquette/a/` et `maquette/captures/`, checklist `design-eviter-look-ia`, mémoire `site-la-ferme`, registre de faits `la-ferme.md`.

Légende des niveaux de preuve : **[Vu]** constaté à l'écran ou dans le code, **[Mesuré]** chiffre relevé (dimensions, contraste, décompte), **[Supposé]** déduction non vérifiée à l'écran.

---

## Les 10 constats les plus importants

| # | Constat | Gravité | Effort | Capture |
|---|---|---|---|---|
| D04 | Après les pizzas, la carte est un long texte : 63 plats sur 80 sans photo, 0 photo en Poissons, 1 sur 7 en Entrées, 5 sur 35 en Pâtes | Important | Gros (shooting) | `b-carte-entier.jpg` |
| D03 | Plats sans photo : le « + » descend sur une ligne à lui seul, chaque plat prend deux fois la hauteur prévue par la maquette | Important | Petit | `m-carte-sans-photo.jpg`, `cmp-sans-photo.jpg` |
| D05 | Tablette du restaurant loin de la maquette validée : heure promise en 14 px une fois acceptée, liens soulignés de 18 px de haut pour Refuser, Annuler, Réimprimer, liseré jaune à gauche | Important | Moyen | `tab-file.jpg`, `tab-en-cours.jpg`, `cmp-tablette.jpg` |
| D02 | Toutes les photos sont publiées en 1200 px de large alors que les originaux font 2133 px : la grande photo de l'accueil est agrandie à l'écran | Important | Petit | `b-accueil.jpg` |
| D06 | Le même jaune sert à « Préversion », aux erreurs, aux codes, aux brouillons légaux : l'erreur d'adresse ressemble à une note d'information | Important | Petit | `m-commande-erreur.jpg` |
| D07 | En-tête de la carte sur téléphone : « Livraison, dès que p… » et « Route de Chancy 100… », l'info qui rassure est coupée | Important | Petit | `m-carte.jpg` |
| D01 | La seule photo des Entrées (salade mêlée) ne sort pas du shooting : fond jaune, bol peint, seule image colorée de la carte | Important | Petit | `m-carte-entrees.jpg`, `photos-shooting.jpg` |
| D08 | Recherche de plat absente, alors qu'elle est dans la maquette et dans `PROMPT.md` §7 | Important | Moyen | `cmp-carte-mobile.jpg` |
| D10 | Aucune transition ni retour au toucher dans tout le site : la fiche apparaît et disparaît sèchement | Important | Petit | (code) |
| D09 | En 1024 px, trois colonnes de vignettes de 120 px à côté du panier : noms coupés, descriptions tronquées | Important | Petit | `t-carte.jpg` |

**Bloquant avant lancement côté design : aucun.** Le seul texte interne visible d'un client (D21, « provenance à compléter ») est déjà bloqué par la vue `plats_bloquants`. Je recommande de traiter D05 avant la répétition de service : c'est l'écran que le personnel lira à un mètre.

## Ce qui marche bien

- **Fidélité à la direction Béton [Vu].** Jetons identiques à la maquette (`--beton #6f6f71`, `--papier #f4f4f2`, `--encre #1c1b1a`, `--basilic #3f6a35`, `globals.css:4-15`), Archivo étroit à 62 % et gras sur tous les titres, photos posées sur le même gris que le plan de travail du shooting. La carte mobile est presque pixel pour pixel celle de la maquette (`cmp-carte-mobile.jpg`).
- **Les interdits sont respectés [Vu].** Aucun rouge, aucun dégradé, aucune ombre portée (`box-shadow` ne sert qu'à des contours intérieurs, sauf le liseré de la tablette, voir D05), aucun emoji, aucune pilule côté client, aucune rangée de trois cartes à icône. Rayon de 4 px partout (37 occurrences sur 44).
- **Le vert basilic est bien gardé** pour « Dans notre zone de livraison » côté client (`globals.css:542`).
- **Les pizzas donnent faim [Vu].** Six photos carrées sur le béton, cohérentes, bien centrées (`m-carte.jpg`, `b-carte.jpg`).
- **La fiche plat avec photo** est le meilleur écran du site, surtout au bureau : photo pleine hauteur à gauche, options en deux colonnes, bouton « Ajouter, CHF 18.00 » qui dit le prix (`b-fiche-pizza.jpg`).
- **États d'entrée bien pensés [Vu].** Hors zone avec sortie « Commander à emporter », cuisine fermée avec choix du jour et de l'heure, verdict de zone en gros chiffres (`m-hors-zone.jpg`, `m-emporter-ferme.jpg`, `m-adresse-zone.jpg`).
- **Le suivi accepté** reprend la grande heure de la maquette : « Prête vers 02h25 » en très grand (`m-suivi-acceptee.jpg`).
- **Ticket imprimé [Vu]** très lisible : poste et numéro en 40 px, « SANS Origan » en gras, aucune somme (`tickets.jpg`).
- **Accessibilité de base [Vu].** Cibles de 44 px côté client, lien d'évitement, contour de focus visible, texte blanc sur béton à 5,0:1 [Mesuré].
- **Le bandeau « Préversion »** n'apparaît que hors production (`page.tsx:20`) et dit précisément ce qui reste à valider.

---

## Constats détaillés

Format : où, reproduire, attendu contre observé, correction, effort. Les lignes de code sont celles de `main` au 12.11.2026.

### Carte et photos

#### D01. Photo de la salade mêlée hors du shooting
- **Gravité** : important. **Effort** : petit.
- **Où** : `/carte`, section Entrées. Fichier `public/plats/salade-melee.jpg` (1200 × 798, seule photo qui n'est pas en 4:3), tiré de `~/Downloads/Plats/Salade melée.avif`.
- **Reproduire** : choisir un mode, ouvrir la carte, aller à Entrées.
- **Attendu** : toutes les assiettes posées sur le même béton gris (principe même de la direction Béton).
- **Observé [Vu]** : fond jaune, bol en céramique peinte, verre de vin, cadrage serré de photo d'ambiance. C'est la seule image colorée de la carte et la première des Entrées (`m-carte-entrees.jpg`, `photos-shooting.jpg`). Le fichier `Poisson.avif` du même dossier a le même problème (set de table vert, verre de sirop) et n'est pas utilisé, à juste titre.
- **Droits** : le registre de faits dit « Photos pro des plats dans ~/Downloads/Plats, droits OK ». Je ne remets pas les droits en cause. Je constate seulement que ces deux images ne viennent visiblement pas de la même séance [Supposé, à confirmer par Jérémy].
- **Correction** : retirer la photo (`photo = null` pour `salade-melee` via le back-office ou `docs/carte-proposee.json` puis `npm run seed:generer`) jusqu'à une photo sur le béton. La salade passe alors dans la liste texte, ce qui est plus cohérent qu'une vignette dissonante.

#### D02. Photos publiées trop petites pour les écrans haute définition
- **Gravité** : important. **Effort** : petit.
- **Où** : `public/accueil.jpg` et `public/plats/*.jpg`, tous en 1200 × 900 [Mesuré]. Originaux : 2133 × 1600 [Mesuré]. Utilisés par `ChoixCommande.tsx:235` (`sizes="100vw"`), `CarteCommande.tsx:43`, `FichePlat.tsx`.
- **Reproduire** : accueil en 1440 px de large (ou un MacBook, écran ×2).
- **Attendu** : photo nette, l'image d'accueil est le premier contact avec la marque.
- **Observé** : sur 1440 px la photo d'accueil est agrandie de 1200 à 1440 px [Mesuré]. Sur un écran ×2 il faudrait 2880 px, soit un agrandissement de 2,4 fois [Supposé, pas d'écran ×2 dans l'environnement de capture]. La fiche plat au bureau affiche la photo sur environ 820 px de haut [Mesuré sur capture] : il faudrait 1640 px sur un écran ×2, le fichier en a 900.
- **Correction** : réexporter les 17 photos depuis `~/Downloads/Plats` en 2133 × 1600, qualité 80. `next/image` produit déjà les tailles intermédiaires (`next.config.ts` n'a pas de réglage `images`, les tailles par défaut vont jusqu'à 3840). Poids servi au téléphone inchangé (le téléphone reçoit toujours la taille dont il a besoin).

#### D03. Plats sans photo : le bouton « + » prend une ligne à lui seul
- **Gravité** : important. **Effort** : petit.
- **Où** : `src/app/globals.css:202-209` (`.sans-image .plat-ajout { grid-column: 2; grid-row: 2; }`).
- **Reproduire** : `/carte` en 375 px, section Pâtes et risottos.
- **Attendu (maquette)** : nom et prix sur la première ligne, description à gauche et « + » à droite sur la même hauteur (`cmp-sans-photo.jpg`, à gauche).
- **Observé [Vu]** : `.plat-txt` occupe la ligne 1 seule, le « + » crée une ligne 2 vide à gauche. Un plat d'une ligne de nom mesure environ 120 px au lieu d'environ 80 px [Mesuré sur capture]. Sur 63 plats, la carte mobile s'allonge d'environ 2 500 px [Supposé, calcul à partir de cette différence].
- **Correction** : dans `globals.css`, ajouter `.sans-image .plat-txt { grid-row: 1 / span 2; }` et `.sans-image .plat-ajout { align-self: end; }`. Vérifier en 375 et en 1440 (trois colonnes).

#### D04. La carte ne donne faim que jusqu'à la fin des pizzas
- **Gravité** : important. **Effort** : gros (photos), petit (mise en page d'appoint).
- **Où** : `/carte`, vue d'ensemble `b-carte-entier.jpg`.
- **Décompte [Mesuré, `docs/carte-proposee.json`]** : 80 plats, 17 avec photo, 63 sans (dont 4 boissons). Par catégorie : Pizzas 6 sur 25, Entrées 1 sur 7, Pâtes 5 sur 35, Poissons 0 sur 4, Viandes 2 sur 2, Desserts 3 sur 3. Le brief parlait de 49 plats sans photo, je trouve 63.
- **Photos du shooting [Mesuré]** : 21 fichiers. Utilisés : les 16 plats en JPEG et le Hero. Non utilisés : `MissItalia_Backup.jpg` (doublon), `Chiacchiere-modified.png` (détourage), `Poisson.avif` et `Salade melée.avif` (voir D01, la seconde est utilisée). Tout ce qui pouvait servir sert.
- **Observé [Vu]** : après six vignettes de pizzas, 19 pizzas en texte, puis 35 pâtes dont 30 en texte, les Poissons entièrement en texte. Le gris continu et les filets blancs donnent une liste de prix, pas une carte qui donne envie.
- **Correction** :
  1. Demander à Jérémy un complément de shooting sur le même plan de travail, dans cet ordre : une entrée froide et une chaude, deux poissons, quatre à six pâtes les plus vendues (c'est lui qui connaît les ventes), deux à trois pizzas de plus. Même lumière, même vue plongeante, même béton.
  2. Ne jamais illustrer une catégorie avec la photo d'un autre plat (une linguine en tête des Poissons serait une fausse promesse).
  3. En attendant les photos, corriger D03, qui rend la liste nettement plus compacte.

#### D22. Vignettes sur ardoise : le plat est petit dans le carré
- **Gravité** : confort. **Effort** : petit.
- **Où** : `globals.css:216-219` (`.plat-media img { object-fit: cover; transform: scale(1.04); }`). Photos `cheeseburger.jpg`, `tartare.jpg`, `tiramisu.jpg`.
- **Observé [Vu]** : sur les ardoises noires, le plat occupe environ un quart du carré, l'ardoise domine (`m-carte-desserts.jpg`, Tiramisu).
- **Correction** : recadrer ces trois fichiers à la source (carré serré sur l'assiette, 1600 × 1600), ou ajouter un zoom par plat (`data-cadrage="serre"` sur le `<li>` et `.plat-media[data-cadrage=serre] img { transform: scale(1.35); }`).

#### D08. Pas de recherche de plat
- **Gravité** : important. **Effort** : moyen.
- **Où** : `src/components/carte/CarteCommande.tsx:33-40` (seule la barre de catégories).
- **Attendu** : champ « Chercher un plat » sur fond blanc au-dessus des catégories, comme la maquette (`cmp-carte-mobile.jpg`) et `PROMPT.md` §7 (« catégories collantes, recherche »).
- **Observé [Vu]** : rien. Avec 80 plats et 35 pâtes, trouver « Gnocchi alla romana » demande de faire défiler toute la section.
- **Correction** : champ `type="search"` collant avec la barre des catégories, filtre côté client sur nom et description (sans accents), sections vides masquées, message « Aucun plat ne correspond » avec un bouton « Effacer ».

#### D20. Aucun onglet de catégorie actif
- **Gravité** : confort. **Effort** : petit.
- **Où** : `globals.css:132-145`. Seul `:hover` souligne l'onglet.
- **Observé [Vu]** : en faisant défiler, rien n'indique la section courante (`m-carte.jpg`).
- **Correction** : `IntersectionObserver` sur les `section.categorie`, `aria-current="true"` sur le lien, même soulignement blanc de 3 px que le survol. Faire défiler l'onglet actif avec `scrollIntoView({ inline: "center" })` de l'onglet dans la barre sur téléphone.

#### D09. 1024 px : grille trop serrée à côté du panier
- **Gravité** : important (iPad et petits portables). **Effort** : petit.
- **Où** : `globals.css:298-301` (trois colonnes dès 900 px) et `globals.css:1013-1018` (colonne panier de 360 px).
- **Observé [Vu]** : en 1024 × 768, vignettes d'environ 120 px, « Miss Italia » et sa description coupées après trois lignes, panier vide qui prend un tiers de l'écran (`t-carte.jpg`).
- **Correction** : deux colonnes de 900 à 1279 px (`grid-template-columns: repeat(2, 1fr)`), trois colonnes à partir de 1280 (la règle existe déjà, `globals.css:318-323`). Colonne panier à 320 px sous 1280.

### En-tête, accueil et commande

#### D07. En-tête tronqué sur téléphone
- **Gravité** : important. **Effort** : petit.
- **Où** : `globals.css:345-349` (`white-space: nowrap; text-overflow: ellipsis`), texte de `ResumeChoix.tsx:22-37`.
- **Observé [Vu]** : « Livraison, dès que p… » et « Route de Chancy 100… » en 375 px (`m-carte.jpg`). La maquette disait « Livraison vers 19h40 » et coupait seulement la rue.
- **Correction** : première ligne courte et sans coupure : « Livraison vers 19h40 » ou « À emporter vers 19h25 » (heure déjà calculée sur l'accueil, à garder dans le `Choix`), seconde ligne coupée seulement au-delà. Remplacer le mot « Compte » par une icône de 44 px avec `aria-label="Compte"` (la maquette avait l'icône) pour rendre environ 60 px à l'adresse.

#### D13. Coupures, espaces insécables et « 2 étage »
- **Gravité** : important (ça se voit dès le premier écran). **Effort** : petit.
- **Observé [Vu]** :
  - « Livraison ou à / emporter ? » : le « à » reste seul en fin de ligne sur téléphone, tablette et bureau (`ChoixCommande.tsx:238`, `m-accueil.jpg`).
  - « 1213 / Onex » coupé dans le pied de page à chaque page (`PiedDePage.tsx:14`, `m-404.jpg`).
  - « Créer mon compte avec cet e- / mail », « Vérifiez- / la », « Appelez- / nous » coupés au trait d'union (`m-commande.jpg`, `m-commande-erreur.jpg`, `m-404.jpg`).
  - « 2 étage » quand le client tape « 2 » (`PageCommande.tsx:138`, même construction en `Tablette.tsx:432` et `impression/ticket.ts:66`).
  - Il n'y a que 6 espaces insécables dans tout `src/` [Mesuré].
- **Correction** :
  - Une fonction `insecables(texte)` dans `src/lib/` qui pose U+00A0 après « à », « de », « N° », entre NPA et localité, entre un nombre et « min ». U+202F avant « ? ! : ; » et à l'intérieur des guillemets. L'appliquer aux titres, au pied de page et aux messages.
  - `h1, h2 { text-wrap: balance; }` et `p { text-wrap: pretty; }` dans `globals.css:41-49`.
  - Écrire « e-mail » avec un trait d'union insécable (U+2011).
  - Étage : afficher « étage 2 » ou « Étage : 2 », jamais une ordinalisation devinée.

#### D27. Premier écran dominé par un bouton gris
- **Gravité** : confort. **Effort** : petit.
- **Où** : `.bouton-principal:disabled`, `globals.css:642`.
- **Observé [Vu]** : sur l'accueil, « Voir la carte » désactivé est le plus grand aplat de l'écran sous la photo, texte blanc sur `#9e9e9a` à 2,7:1 [Mesuré]. Même effet sur « Recevoir un code » et « Choisissez vos pâtes ».
- **Correction** : bouton désactivé en contour (fond transparent, bordure 1,5 px `#bdbdb8`, texte `--encre-douce`), ou bouton actif qui place le focus sur le champ manquant et affiche l'aide juste sous ce champ. L'aide « Indiquez le nom sur la sonnette pour continuer » est aujourd'hui sous le bouton, loin du champ (`m-adresse-zone.jpg`).

#### D06. Le jaune veut dire six choses
- **Gravité** : important. **Effort** : petit.
- **Où** : `#f5e6a3` en dur 11 fois dans `globals.css` : `.bandeau-preversion` (106), `.panier-alerte` (730, les erreurs), `.note-preversion` (1402), `.tab-attente` (1765), `.ges-bloquants` (2079), `.ges-badge-bloque` (2178), `.ges-avert` (2288), `.ges-url` (2328), `.tab-attend` (2356), `.legal mark` (2472), `.legal-ebauche` (2478).
- **Observé [Vu]** : « Nous ne trouvons pas cette adresse » s'affiche dans le même encadré jaune que « Préversion : paiement de test » juste au-dessus (`m-commande-erreur.jpg`). Le client ne voit pas qu'il est bloqué.
- **Correction** : un jeton `--jaune-preversion` réservé à ce qui disparaîtra au lancement (préversion, brouillons légaux, code affiché). Erreurs client : `.panier-alerte { background: var(--blanc); border: 2px solid var(--encre); }` plus l'icône d'alerte du composant `Icone`, `role="alert"` déjà en place. Le jaune de la tablette pour « nouvelle commande » est dans la maquette validée, il peut rester côté personnel.

#### D14. Deux écritures du prix dans la même vue
- **Gravité** : confort. **Effort** : petit.
- **Où** : `src/lib/prix.ts:3-9`.
- **Observé [Vu]** : fiche « 18.– » en titre et « Ajouter, CHF 18.00 » dans le bouton. Panier « 18.– » par ligne et « CHF 43.00 » au total. Supplément « Ail » sans prix alors que les autres affichent « +1.– » (`m-fiche-pizza.jpg`).
- **Correction** : garder « 18.– » partout dans l'interface et réserver « CHF 43.00 » au total et au paiement. Bouton : « Ajouter, 18.– ». Supplément à 0 : afficher « 0.– » ou rien, mais de façon cohérente avec les retraits (« gratuit » est déjà écrit pour eux).

#### D12. Noms de plats incohérents
- **Gravité** : confort. **Effort** : petit.
- **Observé [Vu]** : « Margherita » sur la carte, « Pizza Margherita » dans le suivi, l'e-mail, la tablette et le ticket. « Miss Italia » sur la carte, « Pizza miss Italia » au back-office (casse de la base).
- **Correction** : appliquer `nomAffiche()` (`src/components/Plat.tsx`) au suivi et à l'e-mail. Corriger la casse dans le tableau de validation (« Pizza Miss Italia », « Pizza Prosciutto »…).

#### D19. Barre du panier sur deux lignes serrées
- **Gravité** : confort. **Effort** : petit.
- **Où** : `CarteCommande.tsx:94-102`, `globals.css:803-830`.
- **Observé [Vu]** : « Voir le panier / Encore CHF 12.00 pour le / minimum » en 13 px tient sur trois lignes dans 56 px (`m-barre-panier.jpg`).
- **Correction** : une seule ligne secondaire courte, « Minimum : encore 12.– » en `font-size: 14px`. Garder la barre à 56 px.

#### D11. Fiche d'un plat sans photo : moitié d'écran vide
- **Gravité** : confort (hérité de la maquette). **Effort** : petit.
- **Où** : `globals.css:879-887` et `996-1005`.
- **Observé [Vu]** : sur « Pasta alla carbonara », le bouton d'ajout flotte au milieu de l'écran, 400 px vides dessous (`m-fiche-pates.jpg`).
- **Correction** : `.fiche { display: flex; flex-direction: column; }`, `.fiche-corps { flex: 1; }` pour pousser `.fiche-pied` en bas. Le bouton tombe dans la zone du pouce.

#### D21. Texte interne visible dans la fiche
- **Gravité** : confort (déjà bloqué). **Effort** : nul.
- **Observé [Vu]** : « Provenance : Lardons : provenance à compléter » sur la fiche (`m-fiche-pates.jpg`). La vue `plats_bloquants` empêche la mise en ligne tant que la provenance manque (« provenance à fournir » au back-office, `bo-carte.jpg`). Rien à faire côté design si la règle tient.

#### D24. États vides muets
- **Gravité** : confort. **Effort** : petit.
- **Observé [Vu]** : `/panier` vide, `/commande` sans panier et `/carte` sans mode renvoient tous à l'accueil sans message. Un lien de suivi inconnu affiche la page 404 générique.
- **Correction** : `/panier` vide garde la page avec « Votre panier est vide » et un bouton « Voir la carte ». Suivi inconnu : « Cette commande est introuvable. Le lien vient de votre e-mail de confirmation. » avec le téléphone (textes à passer par `redaction-fr`).

#### D23. Pied de page
- **Gravité** : confort. **Effort** : petit.
- **Où** : `PiedDePage.tsx:12-24`, style `.pied`.
- **Observé [Vu]** : « 1213 / Onex » coupé, interligne d'environ 36 px entre deux lignes d'adresse et liens légaux empilés avec de grands blancs (`m-404.jpg`).
- **Correction** : insécable entre NPA et ville (D13), `line-height: 1.5`, liens sur une ligne avec `gap: 16px` et retour à la ligne naturel.

### Mouvement, focus, suivi, compte

#### D10. Aucune transition, aucun retour au toucher
- **Gravité** : important. **Effort** : petit.
- **Où** : `globals.css` ne contient aucune règle `transition`, `animation` ni `:active` [Mesuré].
- **Observé [Vu]** : la fiche apparaît et disparaît en 0 ms, le fond s'assombrit d'un coup, un bouton pressé ne bouge pas. Sur téléphone, on ne sait pas si l'ajout a marché avant de voir la barre.
- **Correction** (rien de décoratif, seulement des réponses à un geste) :
  - Fiche sur téléphone : entrée par le bas, `transform: translateY(24px)` vers 0 et opacité, 220 ms `cubic-bezier(.2,.8,.2,1)`, sortie 150 ms. Au bureau : fondu 160 ms. Fond : opacité 0 vers 0,5 en 200 ms.
  - Boutons et « + » : `:active { transform: scale(.97); }` en 80 ms.
  - Barre du panier : apparition par le bas en 200 ms, le chiffre change avec une mise à l'échelle 1,15 vers 1 en 180 ms.
  - Tout dans `@media (prefers-reduced-motion: no-preference)`. La règle `reduced-motion` existe déjà (`globals.css:325`).

#### D28. Contour de focus sombre sur le béton
- **Gravité** : confort. **Effort** : petit.
- **Observé [Mesuré]** : contour encre 3 px sur béton, contraste 3,4:1. Conforme au minimum de 3:1 mais peu visible (`m-focus.jpg`).
- **Correction** : `.page-carte :focus-visible { outline-color: var(--blanc); }`.

#### D18. Suivi : des étapes qui ressemblent à un formulaire
- **Gravité** : confort. **Effort** : petit.
- **Où** : `src/app/suivi/[jeton]/page.tsx:97-110`, `globals.css:1225-1258`.
- **Observé [Vu]** : cercles vides et cercle pointé, exactement l'apparence de boutons radio, étape faite en disque blanc plein sans coche, aucune heure (`m-suivi-acceptee.jpg`). La maquette avait une coche et l'heure de chaque étape (`maquette/captures/a-suivi-mobile.jpg`).
- **Correction** : étape faite avec une coche SVG noire dans un disque blanc, heure à droite en chiffres tabulaires (heures déjà en base dans les événements de la commande [Supposé, à vérifier dans `commandes`]), étape à venir en trait fin sans cercle.

#### D26. Connexion de la tablette illisible à un mètre
- **Gravité** : confort (personnel). **Effort** : petit.
- **Observé [Vu]** : encadré de 330 px collé à gauche, texte en 14 px sur une tablette de 1024 px (`tab-connexion.jpg`). Même composant que la connexion client.
- **Correction** : `.page-tablette .form-code { max-width: 480px; margin: 15vh auto 0; font-size: 18px; }`, champs de 56 px.

#### Connexion et compte client
- **[Vu]** Le champ du code (`m-connexion-code.jpg`) est plus étroit que le bouton : aligner les largeurs, `font-size: 28px`, `letter-spacing: .2em`, chiffres tabulaires. Le compte (`m-compte.jpg`) empile cinq encadrés blancs identiques : acceptable, mais « Supprimer mon compte » mériterait un encadré séparé au lieu d'un filet dans « Vos données ». Confort, effort petit.

### Tablette, back-office, ticket, e-mails, icônes

#### D05. Tablette du restaurant
- **Gravité** : important. **Effort** : moyen.
- **Où** : `src/components/tablette/Tablette.tsx`, styles `.tab-*` de `globals.css` (1760-1900).
- **Comparaison à la maquette validée (`cmp-tablette.jpg`) [Vu]** :

| Maquette | Rendu actuel | Effet en cuisine |
|---|---|---|
| Heure annoncée au client en 80 px à côté de la commande | « 02h25 » en grand avant acceptation, puis « Acceptée pour 02h25 » en 14 px gris dans l'onglet En cours (`tab-en-cours.jpg`) | Une fois acceptée, l'heure promise ne se lit plus à un mètre |
| Pastille Pizza ou Cuisine sur chaque ligne | Rien | On ne voit pas ce qui part à quel poste |
| « Refuser et rembourser » en vrai bouton | « Refuser » en lien souligné d'environ 18 px de haut [Mesuré] (`Tablette.tsx:456`) | Cible trop petite pour un doigt, alors qu'elle déclenche un remboursement |
| Actions secondaires en boutons | « Changer l'heure », « Annuler la commande », « Réimprimer pizza », « Réimprimer cuisine » en liens de 13 px (`Tablette.tsx:516`) | « Annuler la commande » à 10 px de « Changer l'heure », sans séparation |
| Bandeau sombre en tête avec l'heure | Titre « Commandes ouvertes » en 20 px | Pas d'horloge, pas d'état des imprimantes visible en grand |
| Encadré noir pour la nouvelle commande | Encadré noir plus un liseré jaune de 6 px à gauche (`globals.css:1827`, `box-shadow: inset 6px 0 0 #e9cf5b`) | Le liseré coloré à gauche est un marqueur « fait par IA » de la checklist. Le message vert de `.tab-message` (1769) a le même défaut |
| « CHOIX penne » en 16 px | Idem en 16 px | Correct de près, limite à un mètre |

- **Correction** : reprendre la maquette sur ces points précis. Heure promise en `font-size: 56px; font-stretch: 62%` en tête de chaque carte d'En cours. Pastille de poste (`border: 1.5px solid; font-size: 14px; padding: 2px 8px`) en fin de ligne. « Refuser et rembourser » en `.bouton-second` pleine largeur sous « Accepter ». Actions secondaires en boutons de 48 px, « Annuler la commande » isolé à droite. Supprimer le liseré (`box-shadow`) de `.tab-nouvelle` et la bordure gauche de `.tab-message`. Lignes de plats à 22 px, options à 18 px.
- **Non vérifié** : lisibilité réelle sous la lumière d'une cuisine et avec reflets, à tester sur la tablette achetée pendant la répétition de service.

#### D25. Back-office
- **Gravité** : confort (gérant seulement). **Effort** : petit.
- **Observé [Vu]** : jusqu'à cinq étiquettes jaunes en 11 px par plat (« prix à valider », « allergènes manquants »…), lecture difficile. Onglets coupés à droite en 1024 px (« Jou… ») sans indication de défilement (`bo-carte.jpg`).
- **Correction** : remplacer les étiquettes par une seule colonne « À faire » en texte 14 px (« Prix, allergènes, 29 suppléments »). Onglets : `flex-wrap: wrap` pour passer sur deux lignes en 1024 px.

#### Ticket imprimé
- **[Vu]** Très bon (`tickets.jpg`). Deux remarques de confort : « + Burrata » mériterait le gras comme « SANS Origan » (le cuisinier doit voir un ajout autant qu'un retrait). La note du client « Bien cuite » gagnerait à être précédée de « Note : » comme sur la maquette.

#### D17. E-mails génériques
- **Gravité** : confort. **Effort** : petit.
- **Où** : `src/lib/courriel/modeles.ts:68-82` et suivants.
- **Observé [Vu, rendu du modèle avec une commande fictive]** : Arial 15 px, pas de logo, lien « Suivre la commande » bleu souligné par défaut du client mail, total pas plus visible que le sous-total (`mails.jpg`). Le code de connexion en 28 px est bien.
- **Correction** : logo PNG de 120 px en tête (`/logo-la-ferme.png` en URL absolue), bouton « Suivre la commande » en tableau (fond `#1c1b1a`, texte blanc, 44 px de haut, rayon 4 px), ligne Total en gras 17 px, couleur des liens `#1c1b1a`. Garder Arial (les polices web ne passent pas partout).
- **Non vérifié** : rendu dans Gmail, Outlook et Apple Mail réels.

#### D15. Favicon et icône d'écran d'accueil
- **Gravité** : important pour l'icône, confort pour le favicon. **Effort** : petit, mais décision de Jérémy.
- **Où** : `src/app/icon.png`, `src/app/apple-icon.png`, `public/icone-192.png`, `public/icone-512.png`, `public/icone-masquable-512.png`.
- **Observé [Vu]** : toutes reprennent le logotype complet « La Ferme » en script fin sur fond `#f4f4f2`. À 16 et 32 px il devient une tache illisible, sur l'écran d'accueil d'un téléphone un trait fin sur un carré pâle (`icones.jpg`, zoom en bas à gauche).
- **Correction** : faire choisir à Jérémy entre deux pistes, toutes deux tirées du logo existant, rien d'inventé : (a) le logotype en papier `#f4f4f2` sur fond bordeaux `#571A13`, agrandi à 80 % de la largeur (le bordeaux reste « au logo », l'icône est le logo) ; (b) la seule capitale « F » du logotype, grande, bordeaux sur papier. Favicon 32 px dans la même piste.

#### D16. Image de partage
- **Gravité** : confort. **Effort** : petit.
- **Observé [Vu]** : `src/app/opengraph-image.jpg` est la photo d'accueil seule, sans logo (`icones.jpg`, à droite). Dans WhatsApp, le nom vient du titre de page, ce qui suffit.
- **Correction** : ajouter le logotype sur une bande papier de 120 px en bas de l'image, sans texte supplémentaire.

---

## Comparaison avec des références réelles

Sites du benchmark §5 ouverts le 12.11.2026 dans le navigateur intégré, cookies refusés. Ce qui suit est ce que j'ai vu aujourd'hui, sauf mention.

| Site | Ce que j'ai vu | Ce que La Ferme a déjà | Ce qui manque à La Ferme |
|---|---|---|---|
| Franco Manca (francomanca.co.uk) | Lettrage dessiné maison en très grand sur une vidéo de flammes. Fenêtre d'inscription à la newsletter dès la fermeture des cookies | Un parcours de commande sans fenêtre surgissante | Un élément signature aussi fort que leur lettrage. Chez La Ferme, ce rôle peut revenir au béton et aux photos, à condition qu'il y ait des photos sur toute la carte (D04) |
| Luigia (luigia.ch) | Vidéo en tête, « CLICK AND COLLECT » qui ouvre une place de marché tierce (`luigia.marketplace.dood.com`) | La commande reste sur le site, dans la même identité, du choix du mode au suivi | Rien à copier sur le parcours. Leur force est la place donnée aux photos de salle, que La Ferme ne peut pas publier tant que les droits manquent (registre de faits) |
| Pizza Pilgrims (pizzapilgrims.co.uk) | Identité très marquée (caractère maison, bandeau défilant), photos de vrais moments avec des gens autour de la table | Une identité retenue, sans gadget | Des photos du lieu et des gens. Seule source admissible : un shooting du restaurant avec droits, à demander à Jérémy |
| Sweetgreen (order.sweetgreen.com) | Choix Retrait, Livraison ou Outpost et lieu demandés avant la carte, en pastilles | Le même ordre (mode et adresse d'abord), avec un verdict de zone plus clair que le leur | Rien sur ce point. [Non vérifié aujourd'hui] : leur carte, leurs options et « recommander » n'ont pas été rouverts |

**Bilan.** Sur le parcours, La Ferme est au niveau de ces références, parfois au-dessus (tout reste sur le site, verdict de zone en gros chiffres, suivi avec grande heure). L'écart est ailleurs : ces sites font saliver par l'image du début à la fin, alors que La Ferme n'a des photos que pour 17 plats. Le deuxième écart est le soin des détails qui trahissent un site non relu : coupures (D13), troncatures (D07), absence totale de mouvement (D10).

---

## Les 5 améliorations qui changeraient le plus la première impression

Classées par effet, avec l'effort.

| Rang | Amélioration | Effet | Effort | Constats |
|---|---|---|---|---|
| 1 | Shooting complémentaire sur le même béton : 2 entrées, 2 poissons, 4 à 6 pâtes, 2 à 3 pizzas. En attendant, retirer la photo de salade dissonante | La carte donne faim jusqu'au dessert, c'est le seul point où le site est sous ses références | Gros (séance photo à organiser par Jérémy), petit pour le retrait | D04, D01 |
| 2 | Lignes compactes pour les plats sans photo et grille à deux colonnes en 1024 px | Carte mobile nettement plus courte, la maquette validée retrouvée | Petit (une dizaine de lignes de CSS) | D03, D09 |
| 3 | Photos réexportées en 2133 px et icône d'écran d'accueil lisible | Netteté du premier écran au bureau et première image vue sur le téléphone du client | Petit | D02, D15 |
| 4 | Passe typographique : insécables, `text-wrap: balance`, en-tête « Livraison vers 19h40 », un seul format de prix, erreurs hors du jaune | Le site cesse d'avoir l'air « non relu » sur les écrans les plus vus | Petit à moyen | D13, D07, D14, D06 |
| 5 | Mouvement qui répond au geste : fiche qui monte, bouton qui s'enfonce, barre du panier qui confirme l'ajout | Sensation d'application soignée, confirmation de l'ajout sans lire | Petit | D10 |

Hors première impression mais à faire avant la répétition de service : D05 (tablette).

---

## Ce que je n'ai pas pu vérifier

- Clavier ouvert sur un vrai téléphone (iOS et Android) : Playwright ne simule pas le clavier logiciel. À tester à la main sur la fiche (note pour la cuisine) et sur la page de commande, avec la barre `.fiche-pied` collante.
- Écran haute définition réel pour D02 (déduit des dimensions).
- Rendu des e-mails dans de vrais clients mail.
- Lisibilité de la tablette dans la cuisine, à la lumière réelle.
- Preview Netlify : non ouverte, pour ne pas écrire dans la base partagée. Le code est le même que l'instance locale (`main`, `d95375f`).
- Imprimante réelle : le ticket est le PNG produit par `pngTicket()` avec une commande fictive, pas une impression.

Vu en passant, hors design, pour l'audit client : la recherche d'adresse « Route de Chancy 100 » propose d'abord « Route de Bellegarde 100, 1284 Chancy » avant la Route de Chancy à Onex (accueil local, réponse de geo.admin.ch).
