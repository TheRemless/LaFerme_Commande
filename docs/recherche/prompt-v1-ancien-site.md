# Commande en ligne du Restaurant La Ferme (livraison et à emporter)

Prompt de construction rédigé le 3.11.2026 à partir des décisions de Jérémy. À coller tel quel dans une session Claude Code ouverte sur `~/Desktop/Site_LaFerme`.

## 1. Rôle et objectif

Tu es le développeur du système de commande en ligne du Restaurant La Ferme (Route de Chancy 132, 1213 Onex). Tu le construis toi-même (système maison choisi par Jérémy le 3.11.2026) dans le dépôt Eleventy du nouveau site. Les clients commandent sur le site en livraison ou à emporter. Une personne du restaurant accepte chaque commande sur une tablette. L'acceptation déclenche l'impression sur deux imprimantes neuves, une en cuisine et une au poste pizza, chacune avec ses seules lignes.

Gain attendu. À 20 commandes par jour de 50 CHF, Uber Eats prélève environ 3 900 CHF par mois en livraison propre (15 %) et 8 320 CHF avec ses coursiers (32 %). Le système maison avec Payrexx coûte environ 360 CHF par mois, presque tout en frais de paiement (calcul sur hypothèses non vérifiées, `comparatif-commande-en-ligne.md` §3). Uber Eats reste actif en parallèle quelques mois, le temps d'une campagne de flyers.

Ton interlocuteur est Jérémy, fils du patron Giuseppe. Il juge sur un rendu, jamais sur une spec. Tu cadres en quelques lignes, tu construis par lots, tu montres.

## 2. Contexte

### Dépôt et stack

| Élément | Valeur |
|---|---|
| Dépôt | `~/Desktop/Site_LaFerme`, GitHub privé `TheRemless/Site_LaFerme`, branche `main`, un seul commit (17.10.2026) |
| Générateur | Eleventy 3, Nunjucks, config `.eleventy.js` (filtres `prix`, `parGroupe`, `plat`, `plats`, `nbPlats`) |
| Hébergement | Netlify, `netlify.toml` contient seulement `command = "npm run build"` et `publish = "_site"` |
| Dépendances | `@11ty/eleventy` seul. Aucun JavaScript côté client, aucun test, aucun workflow GitHub |
| Preview | config `site-laferme` (port 8088) dans `~/Desktop/Claude Plugins/.claude/launch.json`, outil `preview_start` |
| Contrôle de rendu | `~/.claude/skills/eleventy-zwald/scripts/controle.sh <url>` (Lighthouse et captures bureau et mobile) |
| Domaine | `restaurantlaferme.ch` encore sur Wix. Le nouveau site n'est pas en ligne |

### Fichiers clés

| Fichier | Rôle |
|---|---|
| `src/_data/carte.json` | 8 sections (`suggestions`, `entrees`, `pates`, `aldente`, `poissons`, `viandes`, `pizzas`, `enfants`), 139 plats. Champs `nom`, `prix` (CHF entiers TTC), `description`, `note`, `groupe`. **Seule source des prix des plats** |
| `src/_data/restaurant.json` | nom, téléphone `+41227921689` (affiché `022 792 16 89`), e-mail `contact@restaurantlaferme.ch`, adresse, géo, horaires en texte libre |
| `src/_includes/base.njk` | head, JSON-LD `Restaurant` inline, header, footer |
| `src/_includes/header.njk` | nav et bouton « Réserver au 022 792 16 89 » |
| `src/carte.njk`, `src/index.njk` | carte complète et accueil |
| `src/css/site.css` | jetons en tête de fichier |

### Pièges relevés dans le dépôt (à traiter, pas à contourner)

1. **Modifications locales non commitées** sur `README.md`, `base.njk`, `footer.njk`, `carte.njk`, `site.css` et `index.njk` (le design validé fin octobre). **Fichiers non suivis** `Partenaires_CSV/` et `Partenaires_Secret_Travel_and_Tour.xlsx` : données d'une autre entreprise, à ne jamais ajouter à ce dépôt. Avant le lot 1, demande à Jérémy comment intégrer les modifications locales (PR séparée d'abord ou base de ta branche). N'écrase rien, ne commite rien de cela avec ton travail.
2. **Les plats n'ont pas d'identifiant** et des noms se répètent : « Aux morilles » (trois groupes de viandes), « Au poivre vert », « Moutarde à l'ancienne », « Grillé », « Tartare de saumon et pommes Golden » (suggestions et poissons), « Tartare de loup de mer » (deux descriptions différentes). La clé d'un plat doit donc combiner section, groupe et nom (section 5).
3. **Le libellé lisible d'un plat** est souvent `groupe + nom` (« Filet de bœuf (220 g) » + « Aux morilles »). Les tickets et le panier affichent les deux.
4. **Certains plats contiennent déjà un choix** dans leur texte : « Pâtes bambino » (spaghettini ou pennette, tomate, bolognaise, carbonara ou pesto), « Pizza bambino » (Margherita ou prosciutto), « Burger maison gourmand » (bœuf haché ou en tranche), poissons servis « avec légumes et pommes frites, ou riz, ou pâtes » (note de section). Ces choix deviennent des options obligatoires, à faire confirmer.
5. **La section ne suffit pas pour le routage** : « Pizza bambino » est dans `enfants`, « Pizza marinara » et les focacce sont dans `entrees`, les gratins de `pates` passent « au four à bois ». La station se règle par section avec exception par plat.
6. **Les plats à discrétion** (charbonnade, fondues) sont « dès deux personnes » avec « prix par personne ». Ils sont non commandables par défaut.
7. **Le caractère « œ »** est partout (bœuf, œuf, cœurs). Il doit sortir correctement sur l'imprimante (section 8).

### Conventions `eleventy-zwald` à respecter

- Un prix de plat ne s'écrit que dans `carte.json`. Jamais de prix tapé dans un gabarit, une fonction ou un test (les tests lisent `carte.json`).
- Desserts et boissons sont sur des cartes séparées au restaurant et n'entrent pas dans `carte.json`.
- Tout ce qu'un JSON-LD, un `<title>`, une méta, un `og:` ou un `alt` affirme vient du registre de faits. Ne touche pas au JSON-LD pour ce projet sauf demande (et alors `SearchFit schema-markup`).
- Palette : `--encre #231f1c`, `--gris #5e5650`, `--filet #ece7e0`, `--sable #f6f4f1`, `--beton #6f6f72`, `--blanc #ffffff`. `--logo #571a13` reste sur le logo et le mot « Restaurant ». Toute nouvelle couleur passe par un jeton. Pas de rouge vif, pas de bordeaux dans l'interface, pas de dégradé, pas d'ombre décorative, pas d'emoji, pas d'icône de remplissage. Polices Jost (texte) et EB Garamond (carte), auto-hébergées.
- Le site n'a aucun JavaScript et doit le rester hors des pages de commande. Le JavaScript est autorisé sur `/commander/`, `/suivi/` et `/service/` seulement, en modules ES sans framework sauf nécessité argumentée.
- Branche puis PR, jamais de commit sur `main`. Build `npm run build` vert avant chaque PR.

### Faits

Source unique pour tout texte public : `~/.claude/skills/redaction-fr/references/faits/la-ferme.md`. Voix : `~/.claude/skills/redaction-fr/references/voix/giuseppe-la-ferme.md`.

Interdits (inventés par le passé) : four napolitain, four à 450 °C, bois de chêne, banquets, arrêt de tram, tiramisù maison, horloge en direct, légendes « Fig. », mot du patron. Pas de provenance ni de mention sans gluten dans les textes du site (décision du 27.10.2026, voir le conflit légal en section 11). Pas de nombre de places.

Les besoins confirmés le 3.11.2026 (mémoire `commande-en-ligne-la-ferme.md`) ne sont pas encore dans le registre. Avant de les écrire sur une page publique (livraison par les livreurs du restaurant, mêmes prix que la carte, paiement sur place au retrait), propose à Jérémy de les ajouter au registre avec la date. N'écris aucune comparaison avec Uber Eats sans son accord.

Les horaires de `restaurant.json` viennent de Wix (juillet 2026) et le registre les classe « à demander ». Utilise-les comme horaires de commande provisoires, marqués à confirmer.

## 3. Skills à charger, dans l'ordre

| Moment | Skill | Pourquoi |
|---|---|---|
| Avant de toucher au dépôt, à chaque session | `eleventy-zwald` (lire aussi `references/site-laferme.md`) | Conventions, interdits, contrôle de rendu |
| Liste des 139 plats à faire remplir par Jérémy | `xlsx` | Tableau à cocher (commandable, station, options) |
| Avant tout écran (page client et tablette) | `ui-ux-pro-max` + `frontend-design` ensemble | Direction visuelle dans la DA existante |
| Avant de montrer un écran | checklist de la mémoire `design-eviter-look-ia.md` | Jérémy repère tout de suite un écran « fait IA » |
| Tout texte visible par un client (libellés, erreurs, e-mails, SMS, page de confirmation, ébauches légales) | `redaction-fr` avec le registre `la-ferme.md` et la fiche `giuseppe-la-ferme.md` | Ne rien inventer, voix du restaurant |
| Sur tout bug ou test rouge | `superpowers:systematic-debugging` | Cause avant correctif |
| Avant chaque PR | `code-review` puis `security-review` | Paiement et données clients |
| Rappel d'une décision passée | `claude-mem` (mem-search) | Décisions de Jérémy |

Ne charge pas `writing-plans`, pas de spec longue, pas de `brainstorming` sauf besoin réellement flou. Pas de `docs` ni d'Artifact pour des données clients ou des chiffres d'affaires : HTML local seulement.

## 4. Architecture

| Brique | Choix | Justification |
|---|---|---|
| Pages | Eleventy statique : `/commander/` (carte commandable, panier, tunnel), `/suivi/<jeton>/`, `/service/` (tablette, `noindex`, exclu de `robots.txt`) | Même dépôt, même `carte.json`, pas de double saisie des 139 plats |
| Backend | Netlify Functions dans `netlify/functions/`, Node LTS, plus Scheduled Functions pour les tâches périodiques | Pas de serveur à maintenir |
| Plan Netlify | **Personal** (9 USD, 1 000 crédits). Sur Free (300 crédits) le site est mis en pause quand les crédits sont épuisés et un déploiement coûte 15 crédits | `systeme_maison_tech.md` §2 |
| Stockage des commandes | **Netlify Blobs** en lecture forte, derrière une interface `stockage` interchangeable | Supabase Free se met en pause après 7 jours d'inactivité (`systeme_maison_tech.md` §3). La fermeture du 22.12.2026 au 11.01.2027 dure trois semaines, pile quand des commandes à l'avance pour la réouverture peuvent arriver. Blobs évite aussi un sous-traitant de plus (nLPD). 30 commandes par jour tiennent largement |
| Paiement | Interface `paiement` avec deux implémentations, Payrexx et Stripe, choisie par `PAIEMENT_PRESTATAIRE=payrexx\|stripe`. Page de paiement hébergée par le prestataire | Payrexx Standard est moins cher (TWINT 1,25 % + 0.18, cartes 1,65 % + 0.18), Stripe plus simple à coder (TWINT 1,9 % + 0.30, cartes 2,9 % + 0.30) (`systeme_maison_tech.md` §1). Aucune donnée de carte ne passe par nos serveurs |
| Impression | Interface `imprimante` avec Star CloudPRNT en premier (Star mC-Print3 MCP31CI Ethernet, dès 257.38 CHF) et Epson Server Direct Print en second (TM-m30III dès 207.70 CHF) | L'imprimante interroge une URL HTTPS, aucun PC sur place, aucun port entrant. Doc Star plus accessible. Ethernet recommandé (`imprimantes_routage.md` §1) |
| E-mails | Un prestataire transactionnel (Resend ou Brevo, offres gratuites non vérifiées), derrière une interface `notifier` | Confirmation immédiate obligatoire (LCD) |
| SMS | Optionnel, désactivé par défaut, Twilio (0.0769 USD par SMS vers un mobile suisse, `systeme_maison_tech.md` §4) | Prévenir d'un changement d'heure |
| Prix | Module pur `src/js/commande/prix.mjs`, copié tel quel vers `/js/` (passthrough) **et** importé par les fonctions | Un seul calcul. Le navigateur affiche, le serveur décide |

Vérifie dans la documentation actuelle de `@netlify/blobs` les écritures conditionnelles (`onlyIfNew`, `onlyIfMatch` avec ETag). Utilise-les pour le compteur de numéros et les changements de statut concurrents. Si elles manquent, propose une autre solution à Jérémy avant de coder.

Estimation de charge (calcul, à mesurer en recette). Deux imprimantes à 5 s pendant 14 h sur 26 jours font environ 520 000 requêtes par mois, la tablette à 5 s environ 260 000. À 2 crédits par 10 000 requêtes, cela fait environ 160 crédits plus le calcul. Réponds au polling en quelques millisecondes et sans lecture inutile. N'utilise pas l'intervalle de 1 s conseillé pour Epson.

Ne déploie jamais en production pendant un service (de 11h à 14h et de 18h30 à 23h, du mardi au samedi).

## 5. Modèle de données

Montants internes en centimes entiers. Fuseau `Europe/Zurich` partout côté serveur, jamais celui du navigateur.

### Configuration versionnée (dépôt, change par déploiement)

`src/_data/commande.json` décrit ce qui est commandable. `carte.json` n'est pas modifié. Clé d'un plat : `section/slug(groupe ou "-")/slug(nom)`, par exemple `viandes/filet-de-boeuf-220-g/aux-morilles`. Un script de contrôle lancé au build fait trois choses. Il échoue si une clé de `commande.json` n'existe pas dans `carte.json`. Il liste les plats sans entrée. Il liste chaque valeur `À FOURNIR`. En production, une valeur `À FOURNIR` sur un plat commandable fait échouer le build (même logique que `confirmed: false` validée par Jérémy le 26.10.2026).

```json
{
  "version": 1,
  "stationParSection": {
    "pizzas": "pizza",
    "suggestions": "cuisine", "entrees": "cuisine", "pates": "cuisine",
    "aldente": "cuisine", "poissons": "cuisine", "viandes": "cuisine",
    "enfants": "À FOURNIR"
  },
  "plats": {
    "pizzas/-/capricciosa": {
      "commandable": "À FOURNIR",
      "groupesOptions": ["supplements-pizza", "retraits-capricciosa"]
    },
    "enfants/-/pizza-bambino": {
      "commandable": "À FOURNIR",
      "station": "pizza",
      "groupesOptions": ["choix-pizza-bambino"]
    },
    "entrees/focacce-a-partager/focaccia-origan": {
      "commandable": "À FOURNIR",
      "station": "À FOURNIR"
    },
    "viandes/a-discretion-des-deux-personnes/charbonnade-de-boeuf": {
      "commandable": false,
      "motif": "À FOURNIR : vendu à l'emporter ou non"
    }
  },
  "groupesOptions": {
    "supplements-pizza": {
      "type": "ajout", "min": 0, "max": "À FOURNIR",
      "choix": [{ "id": "À FOURNIR", "libelle": "À FOURNIR", "prixCentimes": "À FOURNIR" }]
    },
    "retraits-capricciosa": {
      "type": "retrait", "min": 0,
      "choix": [
        { "id": "jambon", "libelle": "jambon", "prixCentimes": 0 },
        { "id": "champignons", "libelle": "champignons", "prixCentimes": 0 },
        { "id": "oeuf", "libelle": "œuf", "prixCentimes": 0 }
      ]
    },
    "choix-pizza-bambino": {
      "type": "choix", "min": 1, "max": 1,
      "choix": [
        { "id": "margherita", "libelle": "Margherita", "prixCentimes": 0 },
        { "id": "prosciutto", "libelle": "Prosciutto (jambon cuit)", "prixCentimes": 0 }
      ]
    }
  },
  "articlesHorsCarte": {
    "statut": "À FOURNIR (boissons et desserts, cartes séparées, prix inconnus)",
    "exemple": { "id": "À FOURNIR", "libelle": "À FOURNIR", "contenance": "À FOURNIR", "prixCentimes": "À FOURNIR", "alcool": false, "station": "À FOURNIR" }
  }
}
```

Règles du modèle :
- Trois types de groupes. `choix` (obligatoire, un seul), `ajout` (payant, plusieurs), `retrait` (gratuit, plusieurs). Les retraits des pizzas peuvent être proposés à partir de la `description` de `carte.json`, mais seulement comme brouillon que Jérémy valide.
- Le prix des suppléments vit dans `commande.json` et nulle part ailleurs. Aucun prix de supplément n'est inventé.
- Les boissons ont une contenance obligatoire (OIP art. 11 al. 3) et un drapeau `alcool`.
- Les champs `allergenes` et `provenance` sont prévus par plat (section 11), vides tant que Jérémy ne les a pas fournis.

`src/_data/livraison.json`, zones par NPA et localité genevoises, sans API de géolocalisation payante :

```json
{
  "livraisonActive": true,
  "minimumCalculeSur": "À FOURNIR (sous-total sans frais ?)",
  "zones": [
    {
      "id": "zone-1",
      "nom": "À FOURNIR",
      "fraisCentimes": "À FOURNIR",
      "minimumCentimes": "À FOURNIR",
      "trajetMinutes": "À FOURNIR",
      "localites": [{ "npa": "1213", "localite": "Onex" }]
    }
  ]
}
```

Un NPA peut couvrir plusieurs localités : la zone se choisit sur le couple NPA et localité. L'appartenance d'Onex à la zone 1 est un exemple, pas une décision.

`src/_data/horaires-commande.json`, initialisé depuis `restaurant.json` :

```json
{
  "statut": "provisoire, à confirmer par Jérémy (repris de Wix)",
  "fuseau": "Europe/Zurich",
  "services": [
    { "jours": ["mar", "mer", "jeu", "ven", "sam"], "debut": "11:00", "fin": "14:00", "stations": ["cuisine", "pizza"] },
    { "jours": ["mar", "mer", "jeu", "ven", "sam"], "debut": "18:30", "fin": "22:00", "stations": ["cuisine", "pizza"] },
    { "jours": ["mar", "mer", "jeu", "ven", "sam"], "debut": "22:00", "fin": "23:00", "stations": ["pizza"] }
  ],
  "fermetures": [{ "du": "2026-12-22", "au": "2027-01-11", "motif": "fermeture annuelle" }],
  "heuresLivraison": "À FOURNIR (mêmes que la cuisine ?)",
  "delaiPreparationMinutes": "À FOURNIR",
  "pasCreneauMinutes": 15,
  "anticipationMaxJours": "À FOURNIR",
  "capaciteParCreneau": null
}
```

`pasCreneauMinutes: 15` est une proposition technique à valider. Entre 22h et 23h, seuls les articles de la station pizza sont commandables.

### Données vivantes (Netlify Blobs, modifiables depuis la tablette sans déploiement)

| Store | Contenu |
|---|---|
| `commandes` | une entrée par commande, clé `jourService/uuid` |
| `compteurs` | numéro court du jour (`037`), écrit de façon conditionnelle |
| `impression` | file par imprimante (`pizza`, `cuisine`), tâches avec état et tentatives |
| `reglages` | pause (avec reprise automatique à une heure), délai de préparation du moment, plats en rupture du jour, livraison ouverte ou fermée |
| `journal` | événements horodatés (statuts, paiements, impressions, connexions tablette) |
| `limites` | compteurs anti-abus par empreinte d'IP |

Exemple de commande :

```json
{
  "id": "4f0c…", "numero": "037", "jourService": "2027-01-12",
  "creeLe": "2027-01-12T18:41:07+01:00",
  "mode": "livraison",
  "client": { "nom": "…", "telephone": "…", "email": "…" },
  "adresse": { "rue": "…", "npa": "1213", "localite": "Onex", "complement": "…", "zone": "zone-1" },
  "heure": { "souhait": "des_que_possible", "programmeePour": null, "confirmee": "2027-01-12T19:45:00+01:00", "modifieeLe": [] },
  "lignes": [{
    "cle": "pizzas/-/capricciosa", "libelle": "Capricciosa", "station": "pizza",
    "quantite": 2, "prixUnitaireCentimes": 2300,
    "options": [{ "groupe": "retraits-capricciosa", "id": "oeuf", "libelle": "sans œuf", "prixCentimes": 0 }],
    "note": ""
  }],
  "noteClient": "",
  "totaux": { "sousTotalCentimes": 4600, "fraisLivraisonCentimes": "selon zone", "totalCentimes": "…", "tva": [{ "taux": 2.6, "montantCentimes": "…" }] },
  "paiement": { "mode": "en_ligne", "prestataire": "payrexx", "statut": "paye", "reference": "…" },
  "statut": "nouvelle",
  "jetonSuivi": "32 octets aléatoires en base64url",
  "impressions": { "pizza": { "etat": "en_attente", "tentatives": 0 } },
  "historique": [{ "a": "…", "de": "paiement_en_attente", "vers": "nouvelle", "par": "webhook" }]
}
```

La ligne garde une copie du libellé et du prix au moment de la commande. Un changement de carte ne modifie pas une commande passée.

### Statuts

| Statut commande | Sens |
|---|---|
| `paiement_en_attente` | créée, client parti vers la page de paiement. Invisible sur la tablette. Expire après un délai réglable |
| `nouvelle` | payée en ligne, ou à encaisser. Visible et sonore sur la tablette (si la cuisine est ouverte) |
| `acceptee` | heure confirmée, impression lancée |
| `en_preparation` | facultatif, un appui |
| `prete` (retrait) / `partie` (livraison) | notification au client |
| `terminee` | retirée ou livrée |
| `refusee`, `annulee` | avec motif. Remboursement automatique si payée |

| Statut paiement | Sens |
|---|---|
| `paye` | confirmé par le prestataire (jamais par le navigateur) |
| `a_encaisser_retrait` | paiement au comptoir |
| `a_encaisser_livraison` | cash ou carte au livreur, option désactivée tant que Jérémy n'a pas tranché |
| `encaisse` | marqué depuis la tablette |
| `rembourse`, `echec` | |

## 6. Parcours client (mobile d'abord)

1. **Carte commandable** sur `/commander/`, même ordre et mêmes libellés que `/carte/`, prix lus dans `carte.json`. Plat en rupture ou hors station ouverte : grisé avec la raison en clair. Les plats non commandables n'apparaissent pas.
2. **Fiche plat** : description, options (choix obligatoires d'abord, puis suppléments avec prix, puis retraits), quantité, note libre courte, allergènes et provenance quand ils existent.
3. **Panier** visible en permanence (barre en bas sur mobile, colonne à droite sur bureau). Modifier, supprimer, voir le total. C'est l'outil de correction exigé par la LCD.
4. **Mode** : livraison ou retrait. En livraison, choix NPA et localité dans une liste, puis rue et complément. Hors zone : message clair et proposition du retrait. Minimum non atteint : montant manquant affiché, bouton de paiement inactif. Frais affichés avant le paiement.
5. **Heure** : « dès que possible » (si la cuisine est ouverte) ou un créneau. Les créneaux tiennent compte des services, de la station des articles, des fermetures, du délai de préparation, du trajet de la zone et de la capacité si elle est réglée. Restaurant fermé : la commande à l'avance reste possible sur un créneau futur, avec la phrase « Votre commande sera traitée à l'ouverture de la cuisine » ou une formulation validée par `redaction-fr`.
6. **Coordonnées** : nom, téléphone, e-mail. Rien d'autre d'obligatoire.
7. **Récapitulatif** avec les étapes numérotées visibles (LCD), lien vers CGV et confidentialité, bouton qui nomme l'action réelle (« Payer 46.– » ou « Commander, je paie au retrait »).
8. **Paiement** sur la page hébergée, retour sur `/suivi/<jeton>/`.
9. **Confirmation immédiate par e-mail** (LCD art. 3 al. 1 let. s ch. 4) avec numéro, détail, total, TVA, mode, heure demandée, lien de suivi. Puis un e-mail (et un SMS si activé) à l'acceptation avec l'heure confirmée, à chaque changement d'heure, au départ ou quand c'est prêt puis au refus avec mention du remboursement.
10. **Suivi** : page qui affiche le prénom, le numéro, le statut, l'heure confirmée, rien de plus (pas d'adresse complète). Rafraîchissement par interrogation toutes les 20 s.

Panier gardé dans `localStorage` du visiteur, sans cookie de suivi ni outil d'analyse. Commande en ligne indisponible (pause, panne, fermeture sans précommande) : message avec « Commandes par téléphone au 022 792 16 89 ». Langue : français seulement pour cette version. Tous les textes dans un fichier `src/_data/commande-textes.json` pour traduire plus tard en anglais et en italien comme le reste du site. Les noms de plats restent en français (pas de carte traduite au restaurant). Prévoir une adresse courte `/commander/` facile à imprimer sur les flyers.

## 7. Parcours restaurant (tablette)

- **Connexion** par mot de passe (haché en Argon2 ou scrypt dans une variable d'environnement), cookie de session signé `HttpOnly`, `Secure`, `SameSite=Strict`, longue durée sur la tablette, révocable par rotation du secret. Cinq essais ratés bloquent un quart d'heure.
- **Démarrer le service** : un bouton plein écran au lancement, qui débloque le son (les navigateurs l'exigent) et garde l'écran allumé (Wake Lock). Sans ce geste, la page affiche qu'aucune alerte ne sonnera.
- **File** des commandes `nouvelle`, la plus ancienne en haut. Son répété et bandeau jaune pâle (pas de rouge) tant qu'une commande attend. Rafraîchissement toutes les 5 s. Perte de connexion : bandeau permanent et heure du dernier contact.
- **Accepter** : l'heure proposée est celle du client ou l'heure au plus tôt calculée, ajustable par boutons de 5 et 15 minutes. Un appui valide, imprime et prévient le client.
- **Refuser** avec motif (liste courte et champ libre). Remboursement total automatique si payé, résultat affiché.
- **Modifier l'heure** à tout moment avant `terminee` (au départ du livreur par exemple), avec notification au client.
- **Statuts** en un appui : en préparation, prête ou partie, terminée. Marquer « encaissé » pour les paiements sur place.
- **Réimprimer** une commande entière ou un seul poste.
- **Pause** des commandes en ligne avec reprise à une heure choisie. **Rupture** d'un plat pour la journée. Fermer la livraison seule.
- **À l'avance** : onglet des commandes programmées. Celles reçues pendant la fermeture passent dans la file et sonnent à l'ouverture de la cuisine. Jérémy veut l'impression à l'acceptation : garde cette règle par défaut et affiche l'heure cible en grand sur le ticket (voir la question ouverte sur l'impression différée).
- **Alerte sans réponse** : commande non acceptée après un délai réglable, e-mail (et SMS si activé) au restaurant.
- **Journée** : liste des commandes du jour et export CSV (date, numéro, mode, paiement, montants par taux de TVA, frais de livraison) pour la fiduciaire, puisque la caisse actuelle ne voit pas ces ventes.

Écran pensé pour une tablette posée en cuisine : cibles d'au moins 48 px, texte lisible à un mètre, contraste WCAG AA, aucun survol nécessaire.

## 8. Impression

- **Déclenchement** à l'acceptation seulement. La fonction d'acceptation découpe la commande par station et crée une tâche par imprimante concernée. Une commande sans pizza ne crée rien au poste pizza.
- **Protocole Star CloudPRNT** : avant de coder, lis la référence protocole officielle (guide v2.5.2 du 12.09.2025, cité dans `systeme_maison_tech.md` §5). L'imprimante envoie un POST JSON périodique, le serveur répond s'il a une tâche, l'imprimante la récupère par GET puis confirme par DELETE. Une tâche n'est retirée de la file qu'après confirmation. Une URL et un jeton par imprimante, contrôle de l'adresse MAC envoyée, HTTPS.
- **Epson Server Direct Print** en implémentation secondaire, même interface. Réglage « URL Encode » désactivé sinon les tâches échouent (`imprimantes_routage.md` §1).
- **Encodage** : teste « bœuf », « œuf », « cœurs », « à », « é », « ç » sur l'imprimante réelle. Si « œ » ne sort pas dans la page de codes choisie, remplace-le par « oe » sur le ticket seulement.
- **Format 80 mm** (vérifier le nombre de colonnes du modèle acheté). Gros caractères pour le poste, le numéro et l'heure. Pas de prix sur les tickets de poste.

```
PIZZA                                  N° 037
LIVRAISON          POUR 19:45
Mardi 12.01.2027   acceptée 18:52
Client : Prénom N.   079 … …
Adresse : rue, NPA localité, complément
--------------------------------------------
2 x Capricciosa
    SANS œuf
1 x Pizza bambino
    CHOIX Prosciutto (jambon cuit)
    + <supplément>
--------------------------------------------
Note : <note du client>
Aussi en cuisine : 2 articles
Paiement : PAYÉ EN LIGNE
```

Règles d'affichage : `SANS` en majuscules pour un retrait, `+` pour un ajout, `CHOIX` pour une option obligatoire, une option par ligne, retrait à la ligne suivante si le libellé est long. Paiement en clair : « PAYÉ EN LIGNE », « À ENCAISSER AU RETRAIT » ou « À ENCAISSER À LA LIVRAISON (cash/carte) ».

- **Pannes** : une imprimante qui n'a pas interrogé depuis 60 s passe « hors ligne » sur la tablette avec bandeau. La tâche reste en file et sort au retour de l'imprimante. Après trois échecs signalés par l'imprimante, alerte et bouton « réimprimer ». En secours, le ticket s'affiche sur la tablette en grand.
- **Matériel** : commande une seule imprimante d'abord pour le test (recommandation du comparatif), papier thermique 80 mm, câble Ethernet vers le routeur.

## 9. Horaires et commandes à l'avance

- Horaires de commande depuis `horaires-commande.json` : cuisine de 11h à 14h et de 18h30 à 22h, pizzas jusqu'à 23h, fermé le dimanche et le lundi (source `restaurant.json`, à confirmer).
- Fermetures exceptionnelles dans le même fichier. Première entrée : du 22.12.2026 au 11.01.2027 inclus, réouverture le mardi 12.01.2027.
- Créneau au plus tôt = maintenant + délai de préparation du moment (réglage tablette) + trajet de la zone en livraison, arrondi au pas suivant.
- Dernière commande d'un service : question ouverte (heure de fin, ou fin moins préparation).
- Anticipation maximale en jours réglable. Une commande à l'avance n'est jamais refusée parce que le restaurant est fermé au moment où elle est passée.
- Capacité par créneau (nombre de commandes ou de pizzas) prévue mais désactivée (`null`).
- Changement d'heure d'été et d'hiver couvert par des tests.

## 10. Paiement

- Le serveur recalcule tout à partir de `carte.json`, `commande.json`, `livraison.json` et des réglages : prix, options autorisées, minimum, frais, disponibilité, créneau. Il ignore tout montant venu du navigateur. Différence avec l'affichage : refus avec message et panier rafraîchi.
- Ordre des opérations : commande enregistrée en `paiement_en_attente`, puis création de la session de paiement avec clé d'idempotence, puis redirection.
- Webhooks : signature vérifiée (Stripe `STRIPE_WEBHOOK_SECRET`). Pour Payrexx, si le webhook n'est pas signé, ne crois jamais son contenu et relis la transaction par l'API avant tout changement de statut. Traitement idempotent (un même événement reçu deux fois ne change rien).
- Réconciliation : une Scheduled Function toutes les 5 minutes interroge le prestataire pour les commandes encore `paiement_en_attente` et rattrape un webhook perdu.
- Remboursement total au refus, depuis la tablette, résultat journalisé. TWINT via Stripe accepte les remboursements jusqu'à 180 jours (`systeme_maison_tech.md` §1). Vérifie chez les deux prestataires si les frais sont rendus en cas de remboursement et dis-le à Jérémy.
- Paiement sur place au retrait : la commande arrive directement en `nouvelle` avec `a_encaisser_retrait`. Paiement à la livraison : même mécanisme, derrière `PAIEMENT_LIVRAISON_ACTIF=false` par défaut.
- Activation TWINT chez Stripe : site public, prix en CHF, mentions légales avec raison sociale, forme juridique et adresse, CGV, contact (`systeme_maison_tech.md` §1). Le paiement réel dépend donc de la mise en ligne du nouveau site.
- Mode test uniquement jusqu'à l'accord écrit de Jérémy. Aucune clé de production dans le dépôt, la conversation ou un journal.

## 11. Obligations légales suisses

Source : `research_notes/Commande en ligne La Ferme/obligations_legales.md`. Tu codes les mécanismes. Tu n'écris pas les textes juridiques définitifs : tu prépares des ébauches marquées « à faire relire » et tu demandes à Jérémy de les faire valider par un professionnel.

| Sujet | Exigence | Ce que le code fait |
|---|---|---|
| Commerce électronique (LCD art. 3 al. 1 let. s) | Identité et adresse avec e-mail, étapes de la commande, correction avant envoi, confirmation immédiate par e-mail | Page mentions légales (raison sociale À FOURNIR), étapes visibles, panier modifiable, e-mail envoyé dès la commande enregistrée |
| CGV (LCD art. 8) | Pas obligatoires mais non abusives. Exigées par Stripe pour TWINT | Ébauche à faire relire |
| TVA (LTVA art. 25, OTVA art. 55 et 56) | 2,6 % sur la nourriture et les boissons sans alcool emportées ou livrées, 8,1 % sur l'alcool et sur place. La pièce justificative distincte vaut mesure organisationnelle | Taux par article, ventilation par taux dans l'e-mail et l'export. Les prix TTC restent ceux de la carte (décision de Jérémy). Traitement TVA des frais de livraison non vérifié : à confirmer par la fiduciaire |
| Ticket (LTVA art. 26, OTVA art. 57) | Nom et localité du fournisseur, numéro TVA, date, détail, montant, taux. Nom du client facultatif jusqu'à 400 CHF | Reçu dans l'e-mail. Numéro IDE TVA À FOURNIR (assujettissement à confirmer, seuil 100 000 CHF) |
| Allergènes et provenance (ODAlOUs art. 39 et 44, OIDAl art. 5) | Informations disponibles avant l'achat en vente à distance. Provenance de la viande et du poisson **par écrit** dans tous les cas | Champs par plat affichés sur la fiche avant l'ajout au panier |
| Prix (OIP art. 3, 4, 11) | En CHF, suppléments obligatoires inclus, frais d'expédition affichables à part, contenance des boissons | Aucun frais caché, frais de livraison affichés avant paiement |
| Données (nLPD art. 9, 12, 16, 19) | Responsable, finalités, destinataires, pays étrangers et garanties, contrats de sous-traitance, registre | Ébauche de déclaration listant Netlify, le prestataire de paiement, le service d'e-mail et Twilio si activé. Données minimales. Durée de conservation À FOURNIR (avec la fiduciaire pour la part comptable), purge automatique des données personnelles au-delà |
| Alcool à Genève (LTGVEAT art. 6, 7, 10, 12) | Autorisation de vente à l'emporter distincte de la licence. Interdit de 21h à 7h. 16 ans pour les boissons fermentées, 18 ans pour les distillées. Livraison à confirmer auprès du PCTN | `ALCOOL_ACTIF=false`. Si un jour activé : articles alcool bloqués quand l'heure de commande ou de remise tombe entre 21h et 7h, case d'âge, mention de contrôle d'identité sur le ticket |
| Hygiène (ODAlOUs art. 20) | Annoncer au SCAV le changement d'activité | Point de la liste de mise en ligne, hors code |

**Conflit à trancher par Jérémy.** Il a décidé le 27.10.2026 « pas de provenance » sur le site. La loi exige la provenance de la viande et du poisson par écrit en vente à distance. `carte.json` contient déjà des notes de section reprises de la carte imprimée : bœuf et porc (CH/A), canard (FR), agneau (NZ), bar (France), vongole (Italie), perches (Estonie), saumon (Norvège), gambas (Vietnam), loup de mer (Espagne). Il manque au moins le poulet, le thon, le jambon et les charcuteries. La carte indique aussi « Allergènes : veuillez vous adresser au personnel », ce qui ne suffit pas en ligne. Ne publie aucune provenance ni aucun allergène sans les faits de Jérémy. Le lot 8 (mise en ligne) en dépend.

## 12. Sécurité et fiabilité

- Secrets uniquement dans les variables d'environnement Netlify : clés de paiement, secret de webhook, secret de session, hachage du mot de passe tablette, jetons d'imprimante, clé e-mail et SMS. Un `.env.example` sans valeurs dans le dépôt (`.env` est déjà ignoré).
- Aucune donnée client dans une URL, un nom de clé Blobs lisible publiquement ou un journal non masqué. Le suivi passe par un jeton aléatoire.
- Validation stricte de chaque entrée côté serveur (types, longueurs, quantité maximale par ligne, nombre de lignes, montant maximal par commande réglable). Champ piège contre les robots.
- Limitation de débit sur la création de commande, la connexion tablette et le suivi. Vérifie si la limitation native de Netlify existe sur le plan Personal, sinon compteur dans le store `limites`.
- Vérification de l'origine sur les requêtes qui modifient un état. En-têtes de sécurité dans `netlify.toml` (CSP stricte autorisant seulement le prestataire de paiement, `X-Frame-Options`, `Referrer-Policy`). `/service/` en `noindex`.
- Journal de chaque transition, avec auteur (`client`, `webhook`, `tablette`, `reconciliation`).
- Sauvegarde : une Scheduled Function exporte chaque nuit les commandes de la veille dans un store `sauvegardes` et envoie un résumé à Jérémy. Restauration testée une fois en recette.
- Pendant un service, si une fonction tombe : le site bascule sur le message téléphone, la tablette affiche la perte de connexion, les tâches d'impression déjà créées restent en file. Aucun état important ne dépend de la mémoire d'une fonction.
- Page `/service/etat/` (tablette connectée seulement) : dernier contact de chaque imprimante, dernier webhook, commandes en attente de paiement.

## 13. Lots de livraison

Une branche par lot depuis la base convenue avec Jérémy, une PR par lot, `code-review` puis `security-review`, deploy preview Netlify verte. Après chaque lot, rendu bureau et mobile passé par `controle.sh` et regardé avant d'être montré. Aucune mise en production ni aucun vrai paiement sans l'accord de Jérémy.

| Lot | Contenu | Critères d'acceptation | Rendu à montrer |
|---|---|---|---|
| 0 | Base de travail | Modifications locales traitées selon la réponse de Jérémy. Fichiers Partenaires toujours hors Git. `netlify dev` lance site et fonctions | Rien, un message court |
| 1 | Données et carte commandable en lecture | `commande.json`, `livraison.json`, `horaires-commande.json` créés. Script de contrôle au build (clés, plats sans entrée, liste des `À FOURNIR`). Tableau xlsx des 139 plats à remplir par Jérémy. `/commander/` affiche les plats commandables avec les prix de `carte.json` | `/commander/` bureau et mobile, liste des `À FOURNIR` |
| 2 | Panier et options | Choix obligatoires bloquants, suppléments ajoutés au prix, retraits gratuits, quantités, notes. `prix.mjs` couvert par les tests. Le total affiché égale le total du module | Fiche Capricciosa et Pizza bambino, panier sur mobile |
| 3 | Zones et créneaux | Contrôle de zone, minimum, frais, créneaux selon services, stations, fermetures et délais. Entre 22h et 23h seuls les articles pizza restent commandables. Précommande pendant la fermeture | Tunnel livraison et retrait, cas hors zone, cas restaurant fermé |
| 4 | Paiement en mode test | Interface et deux implémentations, Stripe et Payrexx en mode test. Recalcul serveur, webhook vérifié et idempotent, réconciliation, expiration, paiement au retrait | Paiement test TWINT et carte de bout en bout, montant faussé côté navigateur refusé |
| 5 | Tablette et acceptation | Connexion, démarrage du service, son, file, accepter, refuser avec remboursement test, heure, statuts, pause, rupture, à l'avance, export CSV | Tablette en format paysage, enregistrement d'une acceptation |
| 6 | Impression réelle | CloudPRNT avec une vraie imprimante sur le réseau du restaurant ou de Jérémy. Routage par station, accents et « œ », panne et reprise, réimpression | Photo des deux tickets d'une même commande |
| 7 | E-mails et légal | Confirmation immédiate, acceptation, changement d'heure, prête ou partie, refus. SMS optionnel. Mentions légales, CGV, confidentialité en ébauches marquées à relire. Allergènes et provenance branchés | Captures des e-mails, pages légales en ébauche |
| 8 | Recette et mise en ligne | Recette complète en mode test avec le restaurant pendant un service fictif. Tous les `À FOURNIR` levés. Textes juridiques validés. SCAV annoncé. Domaine et e-mails vérifiés. Bascule en production seulement sur accord écrit | Liste de contrôle cochée, premier vrai paiement de faible montant remboursé |

## 14. Tests

Ajoute `node:test` (intégré à Node, aucune dépendance) et `npm test`. Le build précède les tests.

- **Prix** : plat seul, choix obligatoire manquant, suppléments multiples, retraits à zéro, option d'un autre plat refusée, quantité maximale, frais de zone, minimum atteint ou non, ventilation TVA 2,6 % et 8,1 %, arrondis en centimes. Tous les prix attendus sont lus dans `carte.json` et `commande.json`, jamais écrits dans le test.
- **Routage** : commande mixte qui donne deux tickets, commande sans pizza qui n'en donne qu'un, exceptions par plat (Pizza bambino au poste pizza), article hors carte avec station.
- **Créneaux** : avant l'ouverture, pendant le service, entre 22h et 23h, dimanche, lundi, veille et lendemain de la fermeture annuelle, passage à l'heure d'été et d'hiver, délai de préparation modifié depuis la tablette.
- **Paiement** : webhook rejoué, webhook mal signé, webhook perdu rattrapé par la réconciliation, montant modifié dans la requête.
- **Bout en bout** avec Playwright sur `netlify dev` et le mode test des prestataires : commande livraison payée en TWINT test, commande retrait payée sur place, commande à l'avance pendant la fermeture, acceptation, impression simulée par un faux client CloudPRNT, refus et remboursement, rendu mobile 375 px.

## 15. Questions ouvertes pour Jérémy

| À fournir ou trancher | Lot qui en dépend |
|---|---|
| [ ] Intégration des modifications locales non commitées du site (PR séparée d'abord ?) | 0 |
| [ ] Liste des plats commandables parmi les 139 (tableau xlsx) | 1 |
| [ ] Station de chaque section et exceptions (enfants, focacce et Pizza marinara, gratins au four à bois) | 1, 6 |
| [ ] Charbonnade et fondues à discrétion : vendues à l'emporter ou non | 1 |
| [ ] Boissons et desserts : lesquels, prix, contenances, où les stocker | 1 |
| [ ] Choix inclus confirmés (Pâtes bambino, Pizza bambino, burger, accompagnement des poissons) | 2 |
| [ ] Liste et prix des suppléments, liste des retraits par pizza, nombre maximal | 2 |
| [ ] Zones (NPA et localités), frais, minimum (sur le sous-total ?), temps de trajet | 3 |
| [ ] Horaires de commande et de livraison confirmés, heure de dernière commande, délai de préparation, anticipation maximale | 3 |
| [ ] Payrexx ou Stripe (abonnement Payrexx à confirmer par écrit) | 4 |
| [ ] Paiement à la livraison : oui ou non, cash, carte ou les deux | 4 |
| [ ] Raison sociale exacte, forme juridique, numéro IDE TVA, assujettissement | 4, 7 |
| [ ] Délai d'alerte si une commande n'est pas acceptée, refus automatique ou non | 5 |
| [ ] Impression à l'acceptation même pour une commande programmée tard dans la journée, ou impression différée | 5, 6 |
| [ ] Ticket complet pour l'emballage ou le livreur en plus des deux tickets de poste | 6 |
| [ ] Achat des imprimantes (Star mC-Print3 Ethernet conseillé) et de la tablette, accès au réseau du restaurant | 6 |
| [ ] Allergènes par plat et provenance écrite des viandes et poissons (conflit avec « pas de provenance ») | 7, 8 |
| [ ] Service d'e-mail, SMS oui ou non | 7 |
| [ ] Relecture juridique des CGV, mentions légales et déclaration de confidentialité | 7, 8 |
| [ ] Durée de conservation des commandes (avec la fiduciaire) et traitement TVA des frais de livraison | 7 |
| [ ] Mise en ligne du nouveau site, bascule du domaine et des e-mails `contact@` (prérequis TWINT et e-mails) | 8 |
| [ ] Annonce au SCAV | 8 |
| [ ] Alcool : autorisation PCTN demandée ou alcool exclu | après 8 |

Pose ces questions par petits groupes, au moment où le lot en a besoin, sous forme de liste à cocher. Une valeur manquante reste `À FOURNIR` et bloque la mise en production, jamais le développement.

## 16. Interdits

- Inventer un prix, un supplément, une zone, un frais, un minimum, un horaire, un fait, une provenance, un allergène ou un texte marketing. Promettre un délai de livraison que Jérémy n'a pas donné.
- Écrire un prix de plat ailleurs que dans `carte.json`.
- Rouge ou bordeaux dans l'interface, y compris sur la tablette et pour les erreurs. Dégradés, ombres décoratives, pastilles, emoji, rangées de trois cartes à icône.
- Toucher à la caisse actuelle ou chercher à s'y connecter.
- Mettre une donnée client dans une URL, un journal en clair ou un outil d'analyse.
- Commiter les fichiers Partenaires ou les modifications locales de Jérémy avec ton travail. Commit direct sur `main`.
- Déployer en production, activer une clé de paiement réelle, envoyer un e-mail ou un SMS à un vrai client sans l'accord écrit de Jérémy.
- Déployer pendant un service.
- Activer l'alcool.
- Publier une page légale non relue.
