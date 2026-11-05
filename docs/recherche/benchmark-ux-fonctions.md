# La Ferme Onex : benchmark de commande, fonctions et architecture

Consultation des sources le 5.11.2026. Budget de 30 appels web utilisé en entier.

Convention de lecture
- **[S]** fait sourcé, URL dans la ligne ou en fin de section.
- **[Avis]** recommandation d'expert, non sourcée ici.
- **[Non vérifié]** connaissance antérieure que je n'ai pas pu relire le 5.11.2026 (site bloqué ou hors budget). À contrôler avant d'en faire un argument.

Limites de la collecte
- Uber Eats a renvoyé une vérification anti-robot. Je ne l'ai pas contournée. Uber Eats, Deliveroo et Wolt sont donc décrits de mémoire et marqués [Non vérifié].
- Les sites de commande en application monopage (Domino's, Dieci) ne se lisent pas par simple récupération HTML. Domino's a été lu dans le navigateur avant que le coordinateur en retire l'accès.
- **Pizza Hut n'est plus en Suisse** : pizzahut.ch est un nom de domaine à vendre pour CHF 2'500 [S] https://pizzahut.ch. Il est remplacé dans le benchmark par Luigia (Genève) et Pizza Pilgrims (Londres).

---

## 1. Benchmark de parcours

| Référence | Point d'entrée | Compte ou invité | Panier et options | Créneaux | Suivi | Réassurance |
|---|---|---|---|---|---|---|
| **Domino's Suisse** dominos.ch | **Mode d'abord** : « START YOUR ORDER / DELIVERY or TAKE AWAY » sur l'accueil, puis écran « Is this order for delivery or take away / dine-in? » avec trois choix Delivery, Take away / Dine-in et **Outside** (livraison à un point hors adresse). Formulaire d'adresse : rue, n°, NPA, ville, **étage** [S] | « Sign in » en en-tête, commande sans compte possible [Non vérifié] | Pizza personnalisable ingrédient par ingrédient [Non vérifié] | Commande planifiée possible [Non vérifié] | Pizza Tracker par étapes [Non vérifié] | Mentions TVA incluse, allergènes « ask our store staff », chèques refusés [S]. Livraison offerte dès 40 CHF selon la fiche Uber Eats Genève (source secondaire) |
| **Dieci** dieci.ch | Site vitrine. Bouton « jetzt bestellen » vers une liste de 51 localités « Pizza Kuriere » dont Genève, chaque page locale titrée « Pizza online bestellen ». L'entrée est donc **la localité d'abord** [S] | Non lu | Non lu. Pizza végane et sans gluten mises en avant [S] | Non lu | Non lu | 4 langues DE FR IT EN, cartes-cadeaux [S]. Dieci Genève est aussi sur Uber Eats et Just Eat [S] |
| **Luigia** luigia.ch (Genève) | Deux boutons en tête de page « BOOK » et « CLICK AND COLLECT ». Pas de livraison propre repérée sur la page d'accueil [S] | Non lu (page click & collect introuvable à l'URL testée) | Non lu | Non lu | Non lu | Récit de marque, certifications, photo de produit. Bannière cookies avec « REJECT ALL » au même niveau que « ACCEPT ALL » [S] |
| **Pizza Pilgrims** pizzapilgrims.co.uk | Bouton unique « Order Here » vers une plateforme marque blanche pizzapilgrims.orderswift.com. Click & collect sur la même plateforme, page « Pizza At Home » séparée [S] | Non lu | Non lu | Non lu | Non lu | Histoire des fondateurs, pâte à levée lente, B Corp [S] |
| **Uber Eats** | Adresse demandée d'abord, liste de restaurants filtrée par zone [Non vérifié] | Compte obligatoire [Non vérifié] | Options en feuille modale, obligatoires marquées, quantité +/− [Non vérifié] | « Planifier » par créneaux de 15 à 30 min [Non vérifié] | Carte live du coursier, heure d'arrivée qui se met à jour [Non vérifié] | Frais détaillés au panier, notes, photos [Non vérifié] |
| **Deliveroo** | Adresse d'abord [Non vérifié] | Compte obligatoire [Non vérifié] | Modale d'options, allergènes par plat [Non vérifié] | Planification [Non vérifié] | Étapes plus carte [Non vérifié] | Frais de service et petit panier affichés [Non vérifié] |
| **Wolt** | Adresse d'abord [Non vérifié] | Compte obligatoire, connexion par lien e-mail [Non vérifié] | Modale d'options sobre, photos larges [Non vérifié] | Planification [Non vérifié] | Suivi très détaillé, messages au ton humain [Non vérifié] | Heure estimée affichée sur la fiche restaurant avant d'entrer [Non vérifié] |

### Ce qu'on copie [Avis appuyé sur les lignes [S]]
1. **Le mode puis l'adresse avant la carte**, comme Domino's Suisse. Le champ « étage » existe dès le premier écran chez Domino's. On ajoute nom sur la sonnette et code d'entrée.
2. **L'option « Outside » de Domino's** adaptée à Onex : « au bord du lac », « au parc », « au stade » n'a pas de sens ici. On retient plutôt « Retrait au restaurant » et « Livraison » seulement. À ne pas copier tel quel.
3. **Le bouton unique et visible** de Pizza Pilgrims et Luigia : un seul appel « Commander » dans l'en-tête, partout.
4. **L'heure estimée affichée avant d'entrer** (Wolt, non vérifié) qui rejoint la règle Baymard « afficher une date plutôt qu'une durée » (section 2).
5. **Les modales d'options** des plateformes : obligatoires d'abord, suppléments payants avec prix, retraits gratuits en cases.

### Ce qu'on évite
1. **Compte obligatoire avant de payer** (plateformes, non vérifié) : 18 % d'abandons selon Baymard (section 2).
2. **Le parcours en sous-domaine d'un prestataire** (pizzapilgrims.orderswift.com) : rupture visuelle et de confiance. La Ferme garde la commande sur son domaine.
3. **La carte de localités à la Dieci** : inutile pour un seul restaurant. Une adresse suffit.
4. **Les allergènes renvoyés au personnel** (« ask our store staff » chez Domino's) : la carte en ligne doit les porter.
5. **Les emoji et le ton « Partyyyy »** de Pizza Pilgrims (relevés sur leur page) : contraire à la demande de Jérémy.

Sources section 1
- https://www.dominos.ch et https://www.dominos.ch/en/pages/order/#!/locations/search/?type=Delivery
- https://www.dieci.ch
- https://www.luigia.ch/en/
- https://www.pizzapilgrims.co.uk
- https://pizzahut.ch
- Recherche Uber Eats / Just Eat Genève : https://www.ubereats.com/ch-fr/category/gen%C3%A8ve-ge/pizza , https://www.just-eat.ch/en/takeaway/geneve/italian

---

## 2. Bonnes pratiques sourcées

### 2.1 Abandon et compte

| Fait | Chiffre | Source |
|---|---|---|
| Taux moyen d'abandon de panier (moyenne de 50 études, 2006 à 2025) | 70,22 % | [S] https://baymard.com/lists/cart-abandonment-rate (mise à jour 22.9.2025) |
| Abandon pour coûts supplémentaires trop élevés (livraison, taxes, frais) | 40 % | idem |
| Abandon pour livraison trop lente | 20 % | idem |
| Abandon par méfiance envers le site pour la carte | 19 % | idem |
| **Abandon parce que le site exigeait un compte** | **18 %** | idem |
| Abandon pour processus trop long ou complexe | 17 % | idem |
| Abandon pour erreurs ou plantages | 17 % | idem |
| Abandon parce que le total n'était pas visible dès le début | 12 % | idem |
| Abandon pour moyens de paiement insuffisants | 9 % | idem |
| Sites qui ne mettent pas « commande invité » en option la plus visible | 47 % | [S] lien « Related articles » de https://baymard.com/blog/current-state-of-checkout-ux |
| Répondants qui hésitent à donner leur téléphone au paiement | 68 % | [S] https://baymard.com/blog/current-state-of-checkout-ux (mise à jour 3.11.2026) |
| Sites mobiles dont l'UX de paiement est « médiocre » ou pire | 59 % | idem |

Population des enquêtes Baymard : acheteurs en ligne américains. Transposition à Genève = [Avis].

**Recommandation [Avis]** pour concilier l'exigence de Jérémy (comptes) et les 18 %
- Le compte existe et il est mis en avant, mais il n'est **jamais un mur avant le paiement**.
- Parcours : adresse → carte → panier → coordonnées (prénom, téléphone, e-mail) → paiement. Une case cochée par défaut « Garder mes adresses et mes commandes » crée le compte sans mot de passe à partir de l'e-mail. C'est la création de compte différée, qui ne coûte aucun champ.
- Connexion par **code à 6 chiffres envoyé par e-mail** plutôt que lien magique. Sur iPhone le lien s'ouvre dans le navigateur par défaut et casse la session d'une PWA installée ou d'un panier ouvert ailleurs. Le code se tape dans la même page.
- Expliquer le téléphone à côté du champ : « Le livreur vous appelle s'il ne trouve pas l'entrée. » (réponse directe aux 68 % de Baymard).

### 2.2 Adresse en Suisse

| Règle | Source |
|---|---|
| Domino's Suisse demande rue, n°, NPA, ville et étage séparément avant la carte | [S] dominos.ch (ci-dessus) |
| Masquer la 2e ligne d'adresse derrière un lien teste bien **seulement si la majorité n'en a pas besoin**. Sinon la laisser visible | [S] https://baymard.com/blog/address-line-2 |
| Cacher les champs optionnels peu courants, éviter boutons radio et listes déroulantes pour les champs entièrement facultatifs, marquer clairement obligatoire et facultatif | [S] https://baymard.com/blog/current-state-of-checkout-ux |
| API fédérale `api3.geo.admin.ch/rest/services/api/SearchServer` avec `type=locations&origins=address` : recherche d'adresses suisses, gratuite sous politique d'usage raisonnable | [S] source tierce https://docs.rs/geocoding-async/latest/src/geocoding_async/geoadmin.rs.html . Conditions officielles non relues |

**Formulaire recommandé [Avis]**
1. Un champ unique « Votre adresse » avec autocomplétion geo.admin.ch, filtrée sur les NPA de la zone (1213 Onex, 1212 Grand-Lancy, etc. à fixer par Jérémy).
2. Après sélection : vérification de zone côté serveur sur les coordonnées (polygone PostGIS ou distance), réponse immédiate « Livrable · 35 à 45 min · frais CHF X · minimum CHF Y » ou « Hors zone · retrait au restaurant possible ».
3. Champs visibles d'office, car à Onex la majorité vit en immeuble : **étage**, **nom sur la sonnette**, **code d'entrée** (facultatif), **instructions au livreur** (facultatif, 140 caractères).
4. Saisie manuelle de secours si l'API ne trouve pas l'adresse (nouvelle construction), avec vérification de zone par NPA.
5. Mettre en cache la réponse geo.admin côté serveur. Si l'API tombe pendant le service, basculer sur la liste NPA.

### 2.3 Checkout mobile, frais, temps d'attente

| Règle | Source |
|---|---|
| Afficher une **date ou une heure** de livraison plutôt qu'une durée | [S] https://baymard.com/blog/current-state-of-checkout-ux |
| Proposer **toutes les options de livraison et de retrait dans le même écran**, sans renvoyer au panier | idem |
| Boutons + et − pour la quantité sur mobile | idem |
| 40 % abandonnent pour coûts supplémentaires, 12 % parce que le total n'est pas visible tôt | [S] https://baymard.com/lists/cart-abandonment-rate |

**Application [Avis]**
- Frais de livraison et minimum de commande affichés **dès le choix de l'adresse**, puis en barre fixe en bas de la carte : « Encore CHF 8.50 pour atteindre le minimum ».
- Heure écrite « Livraison vers 19 h 40 » et non « 35 min ». Calcul serveur à partir de la charge réelle (commandes acceptées non livrées) et d'un délai de base réglable depuis la tablette.
- Récapitulatif avant paiement avec sous-total, frais, total TTC et heure.
- Apple Pay, Google Pay et TWINT en tête de l'écran de paiement, carte en dessous.

### 2.4 Accessibilité [Avis, norme non relue le 5.11.2026]
- Viser WCAG 2.2 niveau AA. Contraste 4,5 pour 1 sur les textes, cibles tactiles d'au moins 24 px (44 px recommandé), focus visible, modales d'options piégeant le focus et fermables par Échap, prix et options lus par les lecteurs d'écran (« Supplément burrata, plus 4 francs »).
- Ne jamais signaler un allergène ou une rupture par la seule couleur.
- Formulaires avec `autocomplete` HTML standard (`street-address`, `postal-code`, `tel`, `email`) pour le remplissage automatique iOS et Android.

---

## 3. Fonctionnalités priorisées

Niveaux : **L** lancement, **J** juste après (mois 1 à 3), **P** plus tard.

### Côté client

| Fonction | Niv. | Justification |
|---|---|---|
| Choix livraison ou retrait puis adresse **avant la carte**, vérification de zone | L | Exigence de Jérémy, modèle Domino's Suisse [S], évite les refus après paiement |
| Frais, minimum et heure estimée affichés dès l'adresse | L | 40 % et 12 % d'abandons liés aux coûts cachés [S Baymard] |
| Commande sans mur de compte, compte créé d'une case à cocher | L | 18 % d'abandons sur compte obligatoire [S Baymard] |
| Connexion par code e-mail à 6 chiffres | L | Pas de mot de passe à retenir, marche dans une PWA [Avis] |
| Connexion Apple et Google | J | Utile mais exige comptes développeur et revue. Le code e-mail suffit au lancement [Avis] |
| Adresses enregistrées (plusieurs, avec étage, sonnette, code) | L | C'est la raison d'être du compte pour une clientèle qui recommande [Avis] |
| Historique et « Recommander la même chose » | L | Le geste le plus rentable pour 10 à 30 commandes par jour et une clientèle locale [Avis] |
| Panier persistant (local pour invité, serveur pour compte) | L | Un appel coupe souvent la commande sur mobile [Avis] |
| Options : suppléments payants, retraits gratuits, choix obligatoires, note par plat | L | Demande de Jérémy, règle des plateformes [Avis] |
| Note de commande globale et instructions au livreur | L | Interphones et codes genevois [Avis] |
| Créneaux et commande à l'avance même fermé (jour et quart d'heure) | L | Demande de Jérémy. Capacité par créneau pour ne pas saturer le four [Avis] |
| Paiement Stripe : TWINT, cartes, Apple Pay, Google Pay. Paiement sur place au retrait | L | Choix validé. TWINT supporte Checkout, Payment Element et paiements réutilisables [S Stripe] |
| Page de suivi par étapes (Reçue, Acceptée, Au four, En route, Livrée) avec heure mise à jour | L | Remplace le suivi Uber Eats. Temps réel Supabase [Avis] |
| E-mail de confirmation et de changement d'état | L | Preuve d'achat et lien vers le suivi [Avis] |
| SMS « Le livreur arrive » | J | Coût par SMS, utile surtout en immeuble [Avis] |
| Web push | P | iOS seulement à partir de 16.4, seulement pour une web app ajoutée à l'écran d'accueil et après un geste de l'utilisateur [S WebKit] |
| PWA installable (manifest, icône, hors-ligne de la carte) | J | Prérequis du web push iOS, raccourci pour les habitués [S WebKit, Avis] |
| Allergènes (14 obligatoires) et provenance des viandes et poissons par plat | L | Obligation d'information en Suisse [Avis, ordonnance non relue] et confiance |
| Plats en rupture grisés en temps réel | L | Évite les refus et remboursements payants [Avis, voir 4.2] |
| Pause des commandes et message (« Four complet, reprise à 20 h 15 ») | L | Soupape indispensable en plein service [Avis] |
| Code promo et première commande, QR des flyers avec code pré-rempli | L | La sortie d'Uber Eats doit ramener les clients. Mesurer chaque flyer [Avis] |
| Favoris | J | Moins utile que « recommander », vient vite après [Avis] |
| Avis après commande (privés, note et commentaire) | J | Retour qualité. Publication publique plus tard [Avis] |
| Fidélité (ex. 10e pizza offerte ou points) | P | Une fois les comptes en place et la base mesurée [Avis] |
| FR au lancement, EN juste après, IT plus tard | L / J / P | Clientèle francophone. EN pour les internationaux de Genève [Avis] |
| Suppression du compte et export des données (nLPD) en libre-service | L | Droit d'accès et d'effacement. Coût faible si prévu dès le schéma [Avis, texte de loi non relu] |
| Bannière cookies avec refus au même niveau qu'accepter, ou aucun traceur non essentiel | L | Modèle Luigia [S]. Sans analytics tiers, pas de bannière [Avis] |
| Mentions légales complètes, CGV, adresse, contact | L | **Condition d'activation de TWINT par Stripe** : raison sociale, forme juridique, adresse, CGV, e-mail ou téléphone, prix en CHF [S Stripe] |
| Cartes-cadeaux | P | Dieci le fait [S]. Complexité comptable [Avis] |

### Côté restaurant

| Fonction | Niv. | Justification |
|---|---|---|
| Tablette de commandes : sonnerie continue jusqu'à acceptation, accepter avec délai (20, 30, 45 min), refuser avec motif | L | Cœur du service [Avis] |
| Acceptation = impression CloudPRNT sur deux postes (pizza, cuisine) avec routage par catégorie de plat | L | Demande de Jérémy. Imprimante en HTTPS TLS 1.2 ou 1.3, authentification Basic [S Star] |
| Réimpression d'un ticket et alerte si une imprimante ne s'est pas manifestée depuis 60 s | L | Une imprimante sans papier ne doit pas faire perdre une commande [Avis] |
| Écran « tablette » qui reste allumé (Wake Lock), reconnexion automatique, double canal temps réel et sondage toutes les 10 s | L | Fiabilité en plein service [Avis] |
| Gestion de la carte sans développeur : prix, disponibilité, photos, options, allergènes, catégories, ordre | L | Demande de Jérémy [Avis] |
| Horaires, jours fermés, zones de livraison et frais par zone modifiables | L | Idem [Avis] |
| Remboursement total ou partiel depuis le back-office | L | TWINT : remboursement total, partiel ou multiple jusqu'à 180 jours, en quelques minutes [S Stripe] |
| Fiche client (commandes, adresses, notes internes) | J | Service personnalisé [Avis] |
| Livreurs : assignation, ordre de tournée, lien Google Maps ou Apple Plans, bouton « Livré » | J | Livreurs salariés, 10 à 30 commandes par jour. Ordre manuel suffit au lancement [Avis] |
| Statistiques (CA par jour, panier moyen, heures de pointe, plats, codes promo) | J | Piloter la sortie d'Uber Eats [Avis] |
| Export comptable CSV par taux de TVA (2,6 % et 8,1 %) et par moyen de paiement | J | Taux suisses depuis le 1.1.2024 [Non vérifié, page ESTV en 404 le 5.11.2026]. Livraison et emporter au taux réduit, sur place au normal : à confirmer avec la fiduciaire |
| Rapprochement Stripe (virements, frais) | P | Utile quand le volume se stabilise [Avis] |
| Rôles (patron, service, livreur) | J | Le livreur ne voit pas les statistiques [Avis] |

---

## 4. Architecture technique

### 4.1 Faits qui contraignent l'architecture

| Fait | Conséquence [Avis] | Source |
|---|---|---|
| TWINT ne supporte **ni capture manuelle ni autorisation prolongée** | Impossible d'autoriser puis d'encaisser à l'acceptation. On encaisse au paiement et on rembourse si la commande est refusée | [S] https://docs.stripe.com/payments/twint |
| TWINT n'est pas pris en charge par l'**Express Checkout Element** | Payment Element ou Checkout Session pour TWINT, Express Checkout Element à part pour Apple Pay et Google Pay | idem |
| TWINT : CHF uniquement, min 0,50 CHF, max 5'000 CHF, clients en Suisse | Aucun impact au panier moyen de 50 CHF | idem |
| Mobile : redirection vers une page TWINT puis l'application de la banque, retour au site | La page de retour doit retrouver la commande par l'identifiant Stripe, jamais par le panier local | idem |
| Stripe ne rend pas les frais de la transaction d'origine en cas de remboursement | Chaque refus coûte les frais. D'où zone, ruptures, pause et capacité par créneau **avant** le paiement | [S] https://stripe.com/en-ch/pricing |
| Cartes suisses 2,9 % + CHF 0,30, internationales 3,25 % + CHF 0,30. Tarif TWINT non affiché sur la page générale | Environ CHF 1,75 sur un panier de CHF 50 par carte suisse | idem |
| Supabase propose la région **Zurich `eu-central-2`** | Données en Suisse pour la nLPD | [S] https://supabase.com/docs/guides/platform/regions |
| Supabase Free : projet mis en pause après 1 semaine d'inactivité, pas de sauvegarde | Free interdit en production | [S] https://supabase.com/pricing |
| Supabase Pro : 25 $/mois, 8 Go de base, 100'000 MAU, Realtime 500 connexions et 5 M messages, sauvegardes quotidiennes 7 jours, PITR en option 100 $/mois | Largement suffisant à 30 commandes par jour | idem |
| Vercel Hobby réservé à un usage **non commercial**. Pro 20 $/mois avec 20 $ de crédit d'usage, 1 To de transfert | Pro obligatoire pour un restaurant | [S] https://vercel.com/pricing |
| Resend Free 3'000 e-mails par mois et 100 par jour. Pro 20 $ pour 50'000 | 30 commandes × 3 e-mails × 30 jours ≈ 2'700. Free tient tout juste, Pro dès les codes de connexion et la newsletter | [S] https://resend.com/pricing |
| CloudPRNT : l'imprimante interroge le serveur (POST de statut, GET du ticket, DELETE de confirmation), HTTPS TLS 1.2 ou 1.3, Basic auth. TLS 1.3 peut allonger le traitement et faire échouer une connexion si le serveur coupe trop vite | Point d'API dédié par imprimante, réponse en moins d'une seconde, file `print_jobs` en base | [S partiel] https://star-m.jp/products/s_print/CloudPRNTSDK/Documentation/en/developerguide/cloudprnt-protocol/http-method/index.html et table des matières https://www.star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/index.html . Détail du cycle de mémoire [Non vérifié] |
| Web push iOS seulement en web app installée, iOS 16.4 et plus | SMS ou e-mail restent le canal fiable du suivi | [S] https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |

### 4.2 Comparaison de trois piles

| Critère | A. **Next.js + Supabase Zurich + Vercel Pro** | B. SvelteKit + Supabase Zurich + Netlify | C. Astro (vitrine) + Supabase + fonctions séparées |
|---|---|---|---|
| Simplicité pour un développeur seul avec Claude Code | Très bonne. Pile la plus représentée dans les exemples Supabase, Stripe et Vercel [Avis] | Bonne. Moins de code, moins d'exemples tout faits [Avis] | Moyenne. Deux mondes (statique et application) à faire tenir ensemble [Avis] |
| Temps réel tablette et suivi | Supabase Realtime [S tarifs] | Idem | Idem, îlots client à câbler à la main |
| Auth, comptes, RLS | Supabase Auth et Row Level Security | Idem | Idem |
| Coût mensuel fixe | Supabase 25 $ + Vercel 20 $ + Resend 0 à 20 $ = **45 à 65 $** [S] | Supabase 25 $ + Netlify (tarif non relu) + Resend | Idem B |
| Hébergement des données | Base à Zurich [S]. Fonctions Vercel en UE (région exacte non relue, Francfort probable) [Non vérifié] | Base à Zurich, fonctions Netlify (région non relue) | Idem |
| Continuité avec l'existant | Nouvelle pile | Nouvelle pile | Proche d'Eleventy |
| Tests | Vitest + Playwright, Stripe CLI pour les webhooks [Avis] | Idem | Idem |

### 4.3 Recommandation [Avis]

**Pile A : Next.js (App Router, TypeScript) + Supabase en région Zurich (Pro) + Vercel Pro + Stripe (Payment Element et Express Checkout Element) + Resend, PostGIS pour la zone, Playwright pour les tests de parcours.**
1. Une seule base de code pour le site client, la tablette, le back-office et l'API CloudPRNT.
2. Supabase règle d'un coup Postgres, comptes par code e-mail, RLS, Realtime et stockage des photos, avec les données à Zurich.
3. Next.js est la pile où Claude Code a le plus d'exemples justes. Moins d'erreurs à corriger pour Jérémy.
4. Coût fixe d'environ 45 à 65 $ par mois, sans commission, plus les frais Stripe.
5. La fiabilité tient à trois règles : webhook Stripe idempotent comme seule source de vérité du paiement, tablette en double canal (Realtime et sondage), impression en file en base avec alerte si une imprimante se tait.
6. Paiement encaissé tout de suite (TWINT n'autorise pas la capture différée), refus remboursé en un clic.
7. Le site vitrine Eleventy actuel reste en place et pointe vers `commander.restaurantlaferme.ch` (ou l'inverse quand la nouvelle application est prête).
8. Point à trancher avec un juriste : fonctions Vercel hors de Suisse traitant des données personnelles en transit. La nLPD l'admet vers l'UE, à documenter dans la politique de confidentialité [Avis].
9. Variante B si Jérémy préfère un code plus court, au prix de moins d'exemples.
10. Ne pas prendre C : la commande est une application, pas une page.

---

## 5. Direction UI

### Trois principes [Avis]
1. **La photo fait le travail, la mise en page s'efface.** Une vraie photo par plat prise à La Ferme (même lumière, même assiette, vue légèrement plongeante), grande, sans cadre ni ombre. Fond uni chaud (crème, papier) et un seul accent tiré du four ou de la tomate. Liste de plats en lignes séparées par un filet, pas en cartes flottantes.
2. **Une typographie qui a une voix et des chiffres lisibles.** Un titrage avec du caractère (sérif à empattements marqués ou grotesque condensée d'enseigne), un texte courant sobre, prix alignés à droite en chiffres tabulaires, « CHF 21.50 » toujours au même endroit. Boutons rectangulaires à angles peu arrondis, pleine largeur sur mobile.
3. **La vitesse est un choix visuel.** Barre fixe en bas avec adresse, heure et total. Catégories en onglets collants qui défilent horizontalement. Ajout direct au panier pour un plat sans option, modale seulement si options. Aucune animation d'entrée, aucun carrousel. Objectif : de l'accueil au paiement en moins de 60 secondes pour un habitué via « Recommander ».

À proscrire (demande de Jérémy) : cartes à ombre, boutons pilule, dégradés, emoji, rangées de trois icônes, photos d'illustration génériques.

### Exemples réels

| Site | Statut | Ce qu'on retient |
|---|---|---|
| https://www.pizzapilgrims.co.uk | Consulté [S] | Un seul bouton « Order Here », récit de la pâte et des fondateurs, photo de vrais moments. À ne pas copier : les emoji et la commande sur un sous-domaine Orderswift |
| https://www.luigia.ch/en/ | Consulté [S] | Deux actions en tête (BOOK, CLICK AND COLLECT), place donnée au récit et aux certifications, bannière cookies honnête. Référence genevoise que la clientèle de La Ferme connaît |
| https://www.dominos.ch | Consulté [S] | Exemple de **parcours** à suivre (mode, adresse, étage) et de **style** à éviter (bleu saturé, pictogrammes dans des ronds, interface de chaîne) |
| https://www.francomanca.co.uk | [Non vérifié le 5.11.2026] | Mise en page éditoriale, typographie forte, palette retenue. Bon modèle pour une pizzeria au levain qui ne fait pas « chaîne » |
| https://www.sweetgreen.com | [Non vérifié le 5.11.2026] | Référence de commande directe : composition des options, recommander en un geste, prix et calories visibles. On retient la logique, pas l'esthétique |

---

## Points ouverts pour Jérémy
1. Zone exacte de livraison (NPA ou polygone), frais et minimum par zone.
2. Compte : accepte-t-il qu'un client puisse payer sans compte, le compte se créant d'une case cochée ? C'est le seul moyen de ne pas perdre les 18 % de Baymard.
3. Taux de TVA par mode (livraison, emporter, sur place) à confirmer avec la fiduciaire, la page ESTV étant introuvable le 5.11.2026.
4. Tarif TWINT exact sur Stripe Suisse (page « local payment methods » non relue).
