# Fonctions précommande, horaire, paiement et zones : solutions de commande en ligne utilisables en Suisse (La Ferme, Onex)

Toutes les pages ont été consultées le 3 novembre 2026. « Non documenté » signifie que la page lue ne le dit pas. « Non vérifié » signifie qu'une info n'a été vue que dans un extrait de moteur de recherche ou une source tierce, sans lecture directe de la page officielle.

## Tableau de synthèse

| Solution | (a) Précommande restaurant fermé | (b) Heure choisie client / modifiée par resto + notif | (c) Paiement en ligne carte + TWINT / à l'emporter / à la livraison | (d) Zones avec frais + minimum par zone | Prix / dispo CH |
|---|---|---|---|---|---|
| GloriaFood (fin 30.04.2027) | Oui, gratuit | Client choisit l'heure : oui. Resto fixe une heure à l'acceptation : oui (avis Capterra, non vérifié en doc officielle). Notif client lors d'un changement : non documenté | Cash et carte sur place : oui. En ligne : add-on payant (~29 USD/mois, sources tierces). TWINT : non documenté | Zones dessinées sur carte + minimum par zone : oui. Frais par zone : non vérifié par lecture (frais selon distance de conduite, mise à jour oct. 2024) | Gratuit (base) |
| FoodAmigos (successeur proposé) | Non documenté | Non documenté | Stripe, Apple Pay, « 150+ processeurs » ; TWINT, cash : non documenté | Zones et frais selon distance/temps de conduite : oui ; minimum : non documenté | Prix non affiché ; 35 USD/mois et 1er mois offert selon sources tierces (non vérifié). Suisse : présente dans le formulaire démo seulement |
| Wix Restaurants Orders | Préco « Preorder only » ou « ASAP ou plus tard » : oui ; commande pendant la fermeture pour la prochaine ouverture : non documenté | Client choisit l'heure : oui. Changement par resto + notif : non documenté | Paiements manuels (cash…) : oui. TWINT : via fournisseur tiers TFTW ou Worldline GoPay | Rayon, dessin libre, code postal (code postal hors CH) ; frais + minimum + délai par zone : oui | Prix CHF non vérifiés |
| Shopify + Zapiet Eats | Non documenté | Créneaux client : oui. Changement + notif : non documenté (e-mail générique listé) | Non documenté dans les pages lues | Rayon, distance de conduite, zone dessinée ; minimum + frais (fixe ou %) par zone : oui | Prix contradictoires (voir détails) |
| Lightspeed Order Anywhere (K-Series) | Non documenté | Retrait/livraison programmés : oui. Changement + notif : non documenté | En ligne carte, Apple Pay ; **TWINT en Suisse : oui** ; paiement en personne (cash, carte) au retrait : oui | Zone, minimum, frais en livraison propre : oui (page Amérique du Nord) | Add-on à l'abonnement Lightspeed, prix sur demande |
| Flipdish | Oui (« Always appear open » + précommande jusqu'à X jours) | Créneaux imposés : oui. Changement + notif : non documenté | Non documenté | Rayon ou polygone ; frais + minimum par zone : oui | Dispo CH non vérifiée |
| Pikit (romand) | Non documenté explicitement (pause avec reprise auto) | Créneaux client : oui. Reprogrammation par resto + e-mail client : oui. SMS : non | Carte, Apple/Google Pay, TWINT (offre Max) ; « à la remise » / « au livreur » : oui | Par localité ; minimum + frais + temps de trajet par zone : oui | 89 / 139 / 199 CHF/mois TTC |
| Yoordi | Non documenté | Heures et délai paramétrables : oui. Changement + notif : non documenté | Carte, TWINT, Apple Pay (POS) ; cash/à la livraison non documenté | Non documenté | POS dès 63.20 CHF/mois |
| SIDES | Non documenté | Non documenté | Non documenté | Non documenté | Société allemande ; dispo CH non vérifiée |
| MENU TIGER | Non documenté | Non documenté ; reçu e-mail/SMS : oui | Cash, carte, PayPal, Stripe, Adyen ; TWINT non documenté | Non documenté | Prix non affichés sur la page lue |
| orderbird | Non documenté | Non documenté | Non documenté | Frais et minimum mentionnés par un test tiers (non vérifié, page 403) | Présent en Suisse |

## Q1. Quelles solutions gèrent les commandes programmées / précommandes quand le restaurant est fermé ?

### Takeaway
Seuls GloriaFood et Flipdish documentent clairement la prise de commande pendant la fermeture avec traitement à la réouverture. Wix et Pikit gèrent les créneaux futurs mais ne disent pas explicitement que le site accepte une commande quand la cuisine est fermée.

### Cited Findings
- GloriaFood : « Even if your restaurant is closed… you can still accept it when you open as long as the fulfillment time is later » ; le menu affiche que le restaurant est fermé mais accepte les précommandes ; activable « for free » via Setup > Services & opening hours > Scheduled orders ; délai minimum et maximum d'anticipation paramétrables ; page mise à jour le 27.11.2025. Les commandes sont mises en file d'attente « until you're open again » — [GloriaFood, pre-order](https://www.gloriafood.com/pre-order-food-with-online-ordering-system) (consulté le 03.11.2026)
- GloriaFood : fin de vie annoncée par Oracle : « GloriaFood will reach end of life on April 30, 2027 » ; Oracle « does not offer a direct replacement » et renvoie vers FoodAmigos — [gloriafood.com](https://www.gloriafood.com/) (consulté le 03.11.2026)
- Forum utilisateur : les précommandes reçues pendant la fermeture attendent l'acceptation à l'ouverture (témoignage, non officiel) — [SambaPOS forum](https://forum.sambapos.com/t/gloria-food-future-order/22215) (consulté le 03.11.2026)
- Flipdish : option « Always appear open » : « This show the store is open even the store is closed for preordering purposes » ; précommande séparée retrait / livraison ; nombre de jours d'anticipation (ex. 2 ou 30 jours) ; heure limite après laquelle la précommande passe au lendemain — [Flipdish help, Configure pre-ordering](https://help.flipdish.com/en/articles/9585385-configure-pre-ordering) (consulté le 03.11.2026)
- Flipdish : une fermeture temporaire peut laisser passer les précommandes si elles sont activées dans les réglages — [Flipdish help, store hour overrides](https://help.flipdish.com/en/articles/9585719-set-up-flipdish-store-hour-overrides-through-flipdish-portal) (consulté le 03.11.2026, via extrait de recherche)
- Flipdish POS : les commandes programmées restent « Pending » et ne s'impriment qu'à l'approche de l'heure de préparation — [Flipdish help](https://help.flipdish.com/en/articles/9585464-what-happens-if-i-receive-an-online-order-to-my-flipdish-pos-before-a-float-session-has-been-opened-or-after-it-has-been-closed) (consulté le 03.11.2026, via extrait de recherche)
- Wix Restaurants Orders (nouvelle app) : modes « ASAP only », « ASAP or scheduled for later », « Preorder only » ; limite d'anticipation réglable (ex. 10 à 30 jours, coupure hebdo) ; « Customers can select fulfillment times that occur during your pickup or delivery hours » ; rien sur la commande passée pendant la fermeture — [Wix, order scheduling](https://support.wix.com/en/article/wix-restaurants-setting-up-order-scheduling-in-wix-restaurant-orders-new) (consulté le 03.11.2026)
- Pikit : créneaux issus des fenêtres de service, exceptions datées et plafonds ; « Pause immédiate des commandes, avec reprise automatique à l'heure choisie » ; capacité par créneau (tickets et unités cuisine) ; rien d'explicite sur la commande pendant la fermeture ni sur l'anticipation maximale — [pikit.ch](https://pikit.ch) ; [Pikit horaires et créneaux](https://pikit.ch/fonctionnalites/horaires-et-creneaux) (consultés le 03.11.2026)
- Zapiet Eats : « On-demand and scheduled orders » ; fréquence des créneaux de livraison ; dates selon l'horaire du menu ; rien sur la fermeture — [Shopify App Store, Zapiet Eats](https://apps.shopify.com/zapiet-eats) ; [Zapiet, configure local delivery](https://support.zapiet.com/eats/en/articles/8979855-configure-local-delivery) (mis à jour le 21.09.2026, consultés le 03.11.2026)
- Lightspeed Order Anywhere : « scheduled order pickup » — [Lightspeed K-Series, About Order Anywhere](https://k-series-support.lightspeedhq.com/hc/articles/1260803517810) ; « same-day, express and scheduled delivery orders » — [Lightspeed product-info (Amérique du Nord)](https://product-info.lightspeedhq.com/order-anywhere-k-series-noam) (consultés le 03.11.2026)
- Yoordi : « You can individually determine at what times to order and how much lead time you need » ; bons de précommande imprimés le matin ou 30 min avant retrait — [Yoordi, delivery webshop](https://www.yoordi.com/delivery-webshop) (consulté le 03.11.2026)

### Inferences
- Pour le besoin (a) tel que formulé (commande la nuit, arrive à l'ouverture), GloriaFood et Flipdish sont les seuls documentés. Pikit pourrait le permettre via les créneaux du lendemain mais ce n'est pas écrit.

### Gaps
- FoodAmigos, SIDES, MENU TIGER, orderbird : aucune doc lue sur la précommande.
- Lightspeed : comportement quand le restaurant est fermé non documenté.

## Q2. Quelles solutions permettent au restaurant de fixer ou modifier l'heure à l'acceptation, avec notification au client ?

### Takeaway
Pikit est le seul à documenter noir sur blanc la reprogrammation d'une commande par le restaurant avec e-mail au client. GloriaFood permet de fixer l'heure à l'acceptation (avis utilisateurs) mais la notification client n'est pas confirmée en doc officielle. Aucune solution lue ne documente un SMS au client lors d'un changement d'heure.

### Cited Findings
- Pikit : « Commandes déjà prises reprogrammées sur un autre créneau, le client prévenu par e-mail » ; « chaque étape part par e-mail, avec le lien de suivi » ; SMS non mentionné ; e-mail aussi si le créneau de livraison change — [Pikit horaires](https://pikit.ch/fonctionnalites/horaires-et-creneaux) ; [Pikit livraison](https://pikit.ch/fonctionnalites/livraison) ; [pikit.ch](https://pikit.ch) (consultés le 03.11.2026)
- GloriaFood : acceptation automatique possible avec heure prédéfinie pour retrait, livraison « (even per zone) » et sur place ; pour les commandes programmées, c'est le client qui fixe l'heure — extrait de recherche d'une page GloriaFood/Oracle, [Oracle docs, Automatically Accept Orders](https://docs.oracle.com/en/industries/food-beverage/simphony/simgi/t_gf_auto_accept_orders.htm) (non vérifié par lecture directe, 03.11.2026)
- GloriaFood : un utilisateur indique pouvoir donner « customized fulfillment times » ou accepter l'heure choisie par le client — [Capterra avis](https://www.capterra.com/p/198378/GloriaFood/reviews/?page=2) (avis, non vérifié, 03.11.2026)
- MENU TIGER : « Automatic receipt generation via email or SMS » ; rien sur la modification d'heure — [MENU TIGER, online food order system](https://www.menutiger.com/features/online-food-order-system) (consulté le 03.11.2026)
- Zapiet Eats : « Email notifications » listées sous le suivi ; SMS et changement d'heure non mentionnés — [Shopify App Store](https://apps.shopify.com/zapiet-eats) (consulté le 03.11.2026)
- Yoordi : SMS au client seulement pour le produit Self Service (« when and where the order can be picked up ») ; rien pour la livraison — [Yoordi delivery webshop](https://www.yoordi.com/delivery-webshop) (consulté le 03.11.2026)
- Flipdish : option « Force customer to select collection time » et intervalle entre créneaux — [Flipdish pre-ordering](https://help.flipdish.com/en/articles/9585385-configure-pre-ordering) (consulté le 03.11.2026)

### Inferences
- La notification client lors d'un changement d'heure par le restaurant reste à vérifier en démo pour toutes les solutions sauf Pikit (e-mail).

### Gaps
- GloriaFood : e-mail/SMS au client à l'acceptation ou au changement d'heure non confirmé dans une page officielle lue.
- Wix, Lightspeed, Flipdish, FoodAmigos, SIDES, orderbird : non documenté.

## Q3. Quelles solutions acceptent cash ou carte à la livraison et paiement au retrait, et TWINT en ligne ?

### Takeaway
Lightspeed Order Anywhere (TWINT en ligne en Suisse + paiement en personne au retrait) et Pikit offre Max (carte + TWINT en ligne, paiement à la remise et au livreur) couvrent le besoin (c). GloriaFood gère cash et carte sur place mais TWINT n'est pas documenté. Wix passe par un fournisseur TWINT tiers.

### Cited Findings
- Lightspeed Order Anywhere : paiement en ligne par Lightspeed Payments (carte, Apple Pay) ; « Online, Switzerland: TWINT » ; Bancontact/iDEAL pour BE/NL ; Stripe possible ; en personne au POS : cash, carte, carte cadeau, retrait payé au retrait via « Allow customers to pay in person » — [Lightspeed K-Series, Enabling payments for Order Anywhere](https://k-series-support.lightspeedhq.com/hc/articles/1260803521850) (consulté le 03.11.2026)
- Lightspeed : TWINT sur Lightspeed Payments activé via ticket support — [Lightspeed K-Series, Setting up Twint](https://k-series-support.lightspeedhq.com/hc/en-us/articles/10798033022491-Setting-up-Twint) (via extrait de recherche, 03.11.2026)
- Pikit : « Paiement en ligne par carte, Apple Pay, Google Pay ou TWINT selon l'offre, ou à la remise » ; paiement en ligne réservé à l'offre Max ; livraison : « Paiement au livreur ou en ligne selon l'offre » (cash ou carte au livreur non précisé) — [pikit.ch](https://pikit.ch) ; [Pikit livraison](https://pikit.ch/fonctionnalites/livraison) (consultés le 03.11.2026)
- GloriaFood : options sur place « cash, card, or call me back and I'll tell you my card details » (page mise à jour le 27.11.2025) — [GloriaFood, on-site payment methods](https://gloriafood.com/on-site-payment-methods) (consulté le 03.11.2026)
- GloriaFood : paiement en ligne = add-on payant, 29 USD/mois selon sources tierces — [CostBench](https://costbench.com/software/food-delivery-platform/gloriafood/) ; [ToolRadar](https://toolradar.com/tools/gloriafood/pricing) (extraits, non vérifié, 03.11.2026). TWINT : non documenté.
- FoodAmigos : Stripe, Apple Pay, « over 150 processors », garder son processeur existant ; TWINT, cash : non mentionnés — [gloriafood.foodamigos.io](https://gloriafood.foodamigos.io/) (consulté le 03.11.2026)
- Wix : « manual payments to accept cash or other forms of payment » (article sur l'ancienne app Restaurants Orders) — [Wix, payment methods for orders](https://support.wix.com/en/article/wix-restaurants-setting-up-payment-methods-for-orders) (consulté le 03.11.2026)
- Wix : impossible de définir des moyens de paiement différents entre retrait et livraison — [Wix feature request](https://support.wix.com/en/article/wix-restaurants-request-setting-different-payment-methods-for-fulfillment-types) (extrait, 03.11.2026)
- Wix : TWINT via le fournisseur tiers TFTW ou via Worldline GoPay (Suisse, CHF) — [Wix, Twint by TFTW](https://support.wix.com/en/article/connecting-twint-by-tftw-as-a-payment-provider) ; [Wix, Worldline GoPay](https://support.wix.com/en/article/connecting-worldline-gopay-as-a-payment-provider) (extraits, non vérifié par lecture, 03.11.2026)
- Yoordi POS : « Card, TWINT, Apple Pay and more » ; traitement « From just 0.99 % » ; cash et paiement au retrait non mentionnés — [yoordi.com](https://www.yoordi.com) (consulté le 03.11.2026)
- MENU TIGER : FAQ liste Cash, carte, PayPal, Stripe, Adyen ; TWINT non mentionné — [MENU TIGER](https://www.menutiger.com/features/online-food-order-system) (consulté le 03.11.2026)

### Inferences
- Pour TWINT en ligne sans fournisseur tiers, seules Lightspeed (Lightspeed Payments, CH) et Pikit Max sont documentées. Yoordi annonce TWINT côté POS sans préciser le webshop.

### Gaps
- Zapiet Eats / Shopify : moyens de paiement non lus (dépendent de Shopify Payments et des apps TWINT du Shopify App Store, non vérifié).
- Flipdish, SIDES, orderbird : non documenté.
- Pikit : distinction cash ou terminal carte au livreur non précisée.

## Q4. Quelles solutions gèrent des zones de livraison avec frais et minimum par zone ?

### Takeaway
Wix, Zapiet Eats, Flipdish et Pikit documentent frais + minimum par zone. Pikit raisonne par localité (adapté à une liste de communes genevoises), Wix et Flipdish par rayon ou polygone (code postal réservé à certains pays), Zapiet par rayon, distance de conduite ou zone dessinée.

### Cited Findings
- Pikit : « Chaque localité livrée a son minimum de commande, ses frais de livraison et son temps de trajet » ; exemple Lausanne 4.– / min 25.–, Le Mont 8.– / min 40.– ; livraison avec sa propre équipe, livreur nommé par départ ; livraison incluse dès l'offre Plus 139 CHF/mois — [Pikit livraison](https://pikit.ch/fonctionnalites/livraison) ; [pikit.ch](https://pikit.ch) (consultés le 03.11.2026)
- Wix : zones par rayon, code postal (USA, Canada, Australie, Royaume-Uni seulement) ou « Draw your own » ; frais, minimum et délai max par zone — [Wix, delivery areas](https://support.wix.com/en/article/wix-restaurants-setting-up-delivery-areas-for-orders) (consulté le 03.11.2026)
- Flipdish : rayon ou polygone ; code postal seulement Royaume-Uni et Irlande du Nord ; « delivery zones cannot be defined by place names » ; frais et minimum par zone ; en cas de chevauchement, frais le plus bas et minimum le plus haut ; article du 02.10.2026 — [Flipdish, edit delivery zones](https://help.flipdish.com/en/articles/9585547-edit-delivery-zones) (consulté le 03.11.2026)
- Zapiet Eats : « Maximum radius », « Maximum driving distance », « Custom delivery area » dessinée ; minimum par zone ; frais fixe ou % ; livraison gratuite au-delà du minimum ; mis à jour le 21.09.2026 — [Zapiet, configure local delivery](https://support.zapiet.com/eats/en/articles/8979855-configure-local-delivery) (consulté le 03.11.2026)
- GloriaFood : zone dessinée sur carte ; « Setting up a minimum order value for low-value areas » — [GloriaFood, delivery software](https://www.gloriafood.com/restaurant-delivery-software) ; frais selon distance de conduite (mise à jour octobre 2024) — [GloriaFood updates Oct 2024](https://www.gloriafood.com/gloriafood-updates-october-2024) (extrait, 03.11.2026)
- FoodAmigos : zones et frais « based on actual driving distance and time » ; minimum non mentionné — [gloriafood.foodamigos.io](https://gloriafood.foodamigos.io/) (consulté le 03.11.2026)
- Lightspeed : « Determine your own delivery zone, minimum basket value and delivery fees » en livraison propre — [Lightspeed product-info (Amérique du Nord)](https://product-info.lightspeedhq.com/order-anywhere-k-series-noam) (consulté le 03.11.2026). Version suisse non lue.

### Inferences
- Pour le canton de Genève, Pikit (par localité) et les solutions à polygone (Wix, Flipdish, Zapiet) conviennent ; le code postal suisse n'est documenté nulle part comme type de zone.

### Gaps
- Yoordi, SIDES, MENU TIGER, orderbird : zones non documentées dans les pages lues.

## Q5. Prix et disponibilité : FoodAmigos, Payrexx, Wix CHF, autres

### Takeaway
Pikit est le seul à afficher un prix public en CHF pour l'ensemble des fonctions. Payrexx n'affiche pas ses abonnements mensuels sur sa page tarifs. Les prix Wix en CHF et le prix FoodAmigos n'ont pas pu être vérifiés.

### Cited Findings
- Pikit : Essentiel 89 CHF/mois (retrait, créneaux, e-mails), Plus 139 CHF/mois (zones de livraison, réservation, domaine), Max 199 CHF/mois (paiement en ligne carte + TWINT, fidélité) ; TTC ; 1 mois gratuit ; annuel = 1 mois offert ; « Pikit est officiellement lancé ! » — [pikit.ch](https://pikit.ch) (consulté le 03.11.2026)
- FoodAmigos : page tarifs sans montant (« One clear price », mensuel résiliable) ; pays : « US, UK, Europe, Canada & Middle East » ; Suisse non citée hors formulaire démo — [FoodAmigos pricing](https://www.foodamigos.io/en/pricing) ; [gloriafood.foodamigos.io](https://gloriafood.foodamigos.io/) (consultés le 03.11.2026). 35 USD/restaurant/mois avec 1er mois offert aux clients GloriaFood selon un concurrent — [AppInstitute](https://appinstitute.com/gloriafood-shutting-down-alternatives/) (extrait, non vérifié)
- Payrexx : offres Free, Standard, Premium, Individual ; montants mensuels non affichés ; frais carte Free 2.50 % + 0.30, Standard 1.65 % + 0.18, Premium 1.35 % + 0.18 ; TWINT Free 1.30 % + 0.30, Standard et Premium 1.25 % + 0.18 CHF ; réduction 30 % pour entreprises de moins de 5 ans — [Payrexx pricing CH](https://payrexx.com/en-ch/pricing) (consulté le 03.11.2026)
- Payrexx : Standard 19 CHF/mois et Premium 49 CHF/mois selon un guide Payrexx daté mai 2026 — [Payrexx guide frais](https://payrexx.com/en-ch/guides/zahlungsgebuehren-marge-handel) (extrait de recherche, non vérifié par lecture)
- Wix : page plans en USD, « Prices and currency vary by location » ; Light 17.77, Core 29.77, Business 39.77, Business Elite 159.77 USD/mois annuel ; « Accept payments » à partir de Core — [Wix plans](https://www.wix.com/plans) (consulté le 03.11.2026). Prix CHF : non vérifié.
- Zapiet Eats : 100 commandes/mois incluses puis 0.10 USD (App Store, prix affiché en THB ~30 USD) ; d'autres extraits donnent 49.99 ou 79.99 USD — [Shopify App Store](https://apps.shopify.com/zapiet-eats) ; [Zapiet pricing](https://zapiet.com/pricing) (contradictoire, 03.11.2026)
- Yoordi : licence POS dès 63.20 CHF/mois — [yoordi.com](https://www.yoordi.com) (consulté le 03.11.2026)
- Lightspeed Order Anywhere : add-on à l'abonnement Lightspeed Restaurant, disponible en Suisse depuis 2021 — [Lightspeed CH news](https://www.lightspeedhq.com/ch/news/lightspeed-ameliore-lexperience-sans-contact-des-restaurants-avec-order-anywhere/) (extrait, 03.11.2026)

### Inferences
- Coût total Wix ou Shopify = abonnement + app + frais du prestataire TWINT ; à chiffrer en démo.

### Gaps
- Prix Wix en CHF (dépend de la géolocalisation, non lisible depuis l'outil).
- Abonnements Payrexx confirmés sur une page officielle lue.
- SIDES (site get-sides.de, erreur SSL sur sides.io), orderbird (test trusted.de en 403 ; 4 % par commande cité en extrait, non vérifié), MENU TIGER (prix non affichés) : fonctions et prix non documentés.
- Disponibilité de Flipdish en Suisse non vérifiée.
