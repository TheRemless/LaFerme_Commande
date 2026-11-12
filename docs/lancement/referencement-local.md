# Référencement local : recherches, concurrents, actions

Relevés du 12.11.2026 sur google.ch (français, Suisse), sans compte, session localisée à Onex ou à la commune cherchée. Un client au Lignon ou à Plan-les-Ouates voit d'autres résultats. Aucun volume de recherche n'est vérifié. Keyword Planner demande un compte Google Ads, Google Trends n'a pas affiché ses courbes et l'outil Ahrefs n'est pas branché. Les vrais chiffres viendront de Search Console quatre semaines après la mise en ligne.

## En bref

La Ferme tient sa commune : première du bloc Google Maps sur « pizza livraison onex », deuxième sur « pizzeria onex », avec 1 116 avis Google (4,2), bien plus que Felicita (509) ou Onex Kebap (391). Dès qu'on sort d'Onex, elle disparaît de la première page (Lancy, Bernex, Confignon, Plan-les-Ouates, Carouge, 1219). Le bouton « Commander » de sa fiche envoie aujourd'hui tout le monde vers Uber Eats et Just Eat. Les trois priorités : le lien de commande Google vers le site, des horaires identiques partout, puis des pages de livraison par commune sur le nouveau site.

## Les recherches qui comptent

« Pack » = les trois restaurants du bloc Google Maps en tête de page.

| Recherche | Intention | Ce qui sort en page 1 aujourd'hui | Place de La Ferme | Intérêt |
|---|---|---|---|---|
| pizza livraison onex | commander | Pack : La Ferme, Onex Kebap, Felicita. Puis Just Eat, Uber Eats, Dieci | 1re du pack, 4 liens en page 1 | Fort, à garder |
| pizzeria onex | commander ou venir | Pack : Felicita, La Ferme, Piscine d'Onex | 2e du pack | Fort |
| la ferme onex, restaurant la ferme onex | trouver La Ferme | Fiche Google complète, site Wix, Tripadvisor, Facebook | Toute la page | Le lien de commande Google se joue ici |
| pizza onex (suggestions : « pizzeria onex la ferme », « pizzeria onex route de chancy ») | commander | Non relevé | Le nom de La Ferme est suggéré par Google | Fort |
| restaurant onex | sortir | Pack : Gros Chêne, Piscine d'Onex, Felicita | Hors pack, site en bas de page | Moyen |
| livraison pizza lancy, pizza lancy, pizzeria petit-lancy | commander | Domino's Palettes, Molino Petit-Lancy, Just Eat, Uber Eats, Dieci | Absente | Fort : zone 1 proposée |
| pizza bernex, livraison pizza bernex, pizza à emporter bernex | commander | Restaurants de Bernex, la moitié de la page porte sur Bernex en Haute-Savoie | Absente | Fort, écrire « Bernex (GE) » ou « 1233 » |
| pizzeria confignon | commander | TheFork, Uber Eats, Place Gourmande (son ancien domaine affiche un site de casino) | Absente, citée dans les recherches associées | Moyen |
| livraison pizza plan les ouates, pizzeria plan-les-ouates | commander | Gradi24, Phoqu'accia, Fresha | Absente | Moyen : zone 2 proposée |
| pizza carouge livraison | commander | Domino's Carouge, Dieci, Uber Eats | Absente | Moyen, concurrence forte |
| pizzeria lignon, pizza chatelaine, pizza 1219 | commander | Pizzerias de Châtelaine et Vernier. « Lignon » se mélange avec Le Chambon-sur-Lignon (France) | Absente | Moyen : Dieci ne livre pas le 1219 |
| livraison pizza genève, pizza à emporter genève | commander | Plateformes et chaînes | Absente | Faible : trop large pour un livreur basé à Onex |
| charbonnade genève (suggestions : « à gogo », « à volonté », « Lignon », « Carouge ») | venir en salle | Taverne du Valais, Le Pradel, Vieux Martin | Absente | Moyen, mais pour la salle, pas la livraison |
| pizza feu de bois genève | commander ou venir | Woodiz, La Pignata, Mama Corleone, guides | Absente | Faible : Felicita, Onex Kebap, La Cité Fleurie et Place Gourmande disent aussi « feu de bois » |

Liste complète des 34 recherches relevées et suggestions Google : notes de recherche du 12.11.2026 (dossier de notes de la session « lancement »).

## Les concurrents qui livrent eux-mêmes

| Concurrent | Où | Livraison en propre | Minimum par commune | Ce qui manque sur son site |
|---|---|---|---|---|
| Dieci Acacias | Acacias 25, 1227 | Oui, boutique en ligne propre, scooters électriques | Carouge CHF 20 ; Onex, Petit-Lancy, Lancy CHF 30 ; Bernex, Confignon, Plan-les-Ouates CHF 40. Pas le 1219 | Frais, paiement, offre |
| Domino's | Carouge et Palettes (Lancy) | Site propre non lisible (erreur 404). Sur Uber Eats : CHF 2.90 plus 10 % du sous-total, minimum CHF 25 | Non vérifié sur son site | non vu |
| Molino Petit-Lancy | Route de Chancy 59 | Retrait commandé sur son propre sous-domaine. Livraison par Uber Eats et Just Eat | Non vérifié | Lien « Livraison » vide |
| Onex Kebap Pizza | Route de Chancy 127, en face | Non vérifié | Non vérifié | Pas de site trouvé |
| Felicita | Chemin Victor-Duret 30, Onex | Non vérifié (salle, 4,5 sur 509 avis) | non vu | non vu |

Ce que personne ne montre sur son propre site (12.11.2026) : TWINT, une offre de première commande, les frais de livraison en clair, les provenances. Le site de La Ferme affiche déjà les frais, le minimum et le délai dès l'adresse saisie, ainsi que les provenances.

Angles libres, à n'utiliser que s'ils sont validés : un minimum plus bas que Dieci à Bernex, Confignon et Plan-les-Ouates (proposition à CHF 30 et 40 contre CHF 40 chez Dieci) ; le 1219 peu couvert en livraison directe ; le retrait avec places bleues et parking de la salle communale.

## Le nouveau site, côté technique

| Point | État dans le code (`origin/main` 0193788) |
|---|---|
| Données structurées | `Restaurant` en JSON-LD sur l'accueil, avec `hasMenu` vers `/carte` et une action de commande (`src/app/page.tsx`) |
| Plan du site et robots | `/`, `/carte` et pages légales publiées, indexation seulement en production (`src/app/sitemap.ts`, `src/lib/site.ts`) |
| Titre et description | « La Ferme, livraison et à emporter », description relue avec `redaction-fr` |
| Pages par commune | Aucune |
| Search Console | Prévue après la bascule (`docs/mise-en-ligne.md`, phase 5) |

Point à décider avant la bascule : si le site de commande prend `restaurantlaferme.ch` à la place du site Wix, relever d'abord toutes les adresses Wix (accueil, « Notre carte & menu », contact) et les rediriger en 301 vers les nouvelles pages. Sinon le site perd les positions acquises sur « la ferme onex » et « pizzeria onex ».

## Actions

### Gains rapides (moins de deux heures chacun)

| Action | Qui | Impact | Dépend de |
|---|---|---|---|
| Ajouter le site comme lien de commande préféré sur la fiche Google | J | Fort : récupère les clics « Commander » qui partent vers Uber Eats et Just Eat | Site en ligne (`fiche-google.md`, étape 8) |
| Catégorie principale « Pizzeria », plus « Livraison de pizzas » | J | Fort sur les recherches pizza et livraison | Accès à la fiche |
| Horaires de livraison et de vente à emporter sur la fiche | J | Moyen : Google montre « ouvert » ou « fermé » pour la livraison | Horaires validés dans le back-office |
| Mêmes horaires sur le site Wix, local.ch, Facebook, Tripadvisor, Trip.com (six versions aujourd'hui) | J | Moyen : Google se fie aux informations qui concordent | Horaires d'ouverture confirmés par Giuseppe |
| Revendiquer local.ch, corriger le lundi « ouvert dès 06:30 » et le texte écrit par une IA, fusionner le doublon « Restaurant La Ferme Sàrl » | J | Moyen | Rien |
| Nouvelle description de la fiche Google (texte prêt dans `fiche-google.md`) | J | Faible à moyen | Rien |
| Déclarer le site dans Search Console et soumettre `/sitemap.xml` | J, guidé par C | Indispensable pour mesurer | Domaine en ligne |
| Lien vers le site de commande depuis l'accueil du site Wix et depuis Facebook | J | Moyen | Choix du domaine |

### Travail de fond (ce trimestre)

| Action | Qui | Impact | Effort | Dépend de |
|---|---|---|---|---|
| Une page de livraison par commune ou par zone (Lancy, Bernex, Confignon, Plan-les-Ouates, Carouge, 1219) avec les vraies données de la base : frais, minimum, délai, communes. Pas de page creuse répétée d'une commune à l'autre | Une session de code, textes avec `redaction-fr`, schéma avec `SearchFit` | Fort hors d'Onex : seule piste naturelle pour y sortir | Moyen | Zones validées |
| Demande d'avis Google dans l'e-mail envoyé après une livraison, sans contrepartie | Une session de code | Moyen : la note de 4,2 est sous Felicita (4,5) | Faible | Resend en production |
| Shooting complémentaire des plats sans photo (63 sur 80), puis photos sur la fiche Google | G, photographe | Moyen | Moyen | `docs/audits/liste-photos.md` |
| Charbonnade : une page claire sur le site principal pour « charbonnade genève » | J, `redaction-fr` | Moyen, pour la salle | Faible | Choix du domaine, prix de la charbonnade (à demander) |
| Liens locaux : annuaire des commerces de la commune d'Onex, associations et clubs que le restaurant soutient déjà (à lister par Giuseppe) | J | Faible à moyen | Faible | Rien |
| Bilan Search Console à quatre semaines : vraies recherches, positions, clics par commune | C | Indispensable | Faible | Search Console déclarée |

Qui : J Jérémy, G Giuseppe, C Claude.
