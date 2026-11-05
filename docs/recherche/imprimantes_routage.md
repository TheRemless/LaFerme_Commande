# Imprimantes cuisine connectées au cloud et routage multi-imprimantes par catégorie (La Ferme, Onex)

Toutes les pages ont été consultées le 3 novembre 2026. Les prix suisses viennent du comparateur Toppreise.ch (agrégateur de revendeurs suisses). Digitec.ch n'a pas répondu (délai dépassé) aux deux tentatives de lecture, ses fiches n'ont donc pas pu être vérifiées.

## 1. Technologies d'impression cloud et modèles (fonctionnement, connectique, prix CHF)

### Takeaway
Deux technologies permettent à une imprimante d'aller chercher seule ses tickets sur une URL HTTPS sans PC ni tablette sur place : Star CloudPRNT (mC-Print3, TSP100IV) et Epson Server Direct Print (TM-m30III et autres modèles à firmware TM-i). Les deux conviennent à un système maison (Netlify + fonctions serverless) car c'est l'imprimante qui interroge le serveur. Prix suisses relevés : Star mC-Print3 USB/LAN dès CHF 257.38 (hors port), Epson TM-m30III dès CHF 207.70. PrintNode impose un ordinateur allumé sur place et Sunmi n'a pas de documentation développeur publique trouvée.

### Cited Findings

**Star CloudPRNT (modèle « pull »)**
- L'imprimante interroge une URL serveur à intervalle régulier par requête HTTP POST : « Set a URL to be polled by the client at a certain interval through HTTP POST » — [Star CloudPRNT, Client Settings](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html)
- Intervalle de polling par défaut de 5 secondes sur mC-Print3, mC-Print2, TSP100IV, TSP100IV SK, mC-Label3, mC-Label2, et 120 secondes sur IFBD-HI01X/02X — [Star CloudPRNT, Client Settings](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html)
- Le firmware 2.2 et plus prend en charge une variante MQTT ; dans ce cas l'intervalle de polling n'est plus utilisé — [Star CloudPRNT, Client Settings](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html)
- L'imprimante ne fait que des requêtes sortantes, aucun port entrant à ouvrir. Réglages : activer CloudPRNT, saisir l'URL du serveur, l'intervalle, et éventuellement un identifiant HTTP Basic. HTTPS/TLS pris en charge, avec certificats CA personnalisés installables — [Star, Use Star CloudPRNT (TSP100IV)](https://star-m.jp/products/s_print/oml/tsp100iv/manual/en/convenientFunctions/settingsCloudPRNT.htm) ; [Star EMEA, What is CloudPRNT](https://star-emea.com/what-is-cloudprnt/)
- Star propose aussi un service hébergé, StarIO.Online, avec des URL du type `https://device.stario.online/cloudprnt/...`, sans infrastructure serveur à soi — [docs WCPOS, Cloud printing](https://docs.wcpos.com/receipts/cloud-printing)
- Le détail du dialogue (statut JSON, `jobReady`, récupération GET, confirmation DELETE) n'est pas sur la page Client Settings lue. Il est dans la référence protocole de Star, non lue ici.
- Un intégrateur (storekit) recommande le câble Ethernet : « Your Star printer must be connected to your router via an ethernet (LAN) cable for reliable cloud printing. WiFi-only setups are not recommended » — [storekit, Connect printing](https://storekit.com/docs/getting-started/launch/connect-printing)

**Epson Server Direct Print (SDP)**
- Le manuel Epson Server Direct Print couvre Server Direct Print et Status Notification et liste le TM-m30III parmi les modèles pris en charge — [Epson, manuel Server Direct Print (PDF rev. U)](https://download3.ebz.epson.net/dsc/f/03/00/15/11/94/75040f7a3a4820be9d893653c34470f99b306384/ov_SDP_um_en_revU.pdf) (via résultat de recherche, PDF non lu en entier)
- Exige une imprimante à firmware TM-i, par exemple TM-T88VI, TM-T88VII, TM-m30III. Réglage dans la page web de l'imprimante, Services > Server Direct Print : on colle l'URL de polling fournie par le service. Intervalle conseillé 1 seconde pour les tickets et 5 secondes pour les statuts. « URL Encode MUST be set to Disable. If URL Encode is enabled, print jobs will fail. » — [Galley Solutions, Epson ePOS Cloud Setup](https://support.galleysolutions.com/cloud-printers-epson-epos-cloud-setup)
- Odoo utilise le même mécanisme (URL et ID copiés depuis la caisse vers Server Direct Print) et recommande le TM-m30III — [Odoo documentation, PR #15589](https://github.com/odoo/documentation/pull/15589.diff)
- Le format exact des tâches (ePOS-Print XML en réponse au POST de l'imprimante) n'a pas été confirmé sur une page lue.

**Sunmi cloud printer (NT311 et famille NT31x)**
- Imprimante thermique 80 mm, USB-C, Bluetooth, Wi-Fi, Ethernet, 250 mm/s — [ERS Online, Sunmi 80mm cloud printer](https://ers-online.co.uk/o30322/c04004005-sunmi-80mm-thermal-receipt-printer-with-cloud-compatibility)
- Chez un éditeur (Redbox), l'imprimante communique directement avec le cloud de l'éditeur, s'enregistre par numéro de série et rejoue les commandes en file des 24 dernières heures à la reconnexion — [Redbox, Sunmi Cloud Printer](https://support.redbox.systems/docs/sunmi-cloud-printer)
- Les bibliothèques développeur trouvées (pub.dev, Android/Flutter) pilotent l'imprimante en local (IP, USB, Bluetooth), pas par une API cloud serveur — [pub.dev sunmi_cloud_printer](https://pub.dev/packages/sunmi_cloud_printer/example) ; [pub.dev sunmi_external_cloud_printer 0.2.0](https://pub.dev/documentation/sunmi_external_cloud_printer/0.2.0/)

**PrintNode (relais logiciel)**
- Il faut un ordinateur avec le client PrintNode par site : « Typically you need one computer per location in which you want to print. » Le nombre d'imprimantes reliées à cet ordinateur est indifférent — [PrintNode, Pricing](https://www.printnode.com/en/pricing)
- Tarifs officiels (EUR) : Lite gratuit (50 impressions/mois, 1 ordinateur) ; Essential 7.20 €/mois (5 000 impressions, 3 ordinateurs) ou 72 €/an ; Standard 23.20 €/mois (25 000 impressions, 5 ordinateurs) ; Premium 79.20 €/mois. En USD : Essential 9 $/mois, Standard 29 $/mois, Premium 99 $/mois. Pas de grille en CHF — [PrintNode, Pricing](https://www.printnode.com/en/pricing)

**Prix suisses relevés (Toppreise.ch)**

| Modèle | Variante / connectique | Prix le plus bas | Source |
|---|---|---|---|
| Star mC-Print3 MCP31CI BK (noir) | USB 2.0, Ethernet 10/100, massicot | CHF 257.38 hors port ; CHF 266.88 port compris | [Toppreise, mC-Print3](https://www.toppreise.ch/browse?q=Star+Micronics+mC-Print3) |
| Star mC-Print3 MCP31CI WT (blanc) | USB 2.0, Ethernet 10/100, massicot | CHF 271.50 | idem |
| Star mC-Print3 MCP31CBI (blanc) | Wi-Fi, Bluetooth (d'après la fiche) | CHF 324.72 hors port ; CHF 334.22 port compris | idem |
| Star mC-Print3 MCP31CBI BK (noir) | Bluetooth (fiche tronquée) | CHF 345.55 | idem |
| Star mC-Print3 mCP31L (orderflow.ch) | USB, LAN, USB-Host | CHF 265.25 | idem |
| Epson TM-m30III noir | non précisé sur la page | CHF 207.70 port compris | [Toppreise, TM-m30III](https://www.toppreise.ch/browse?q=Epson+TM-m30III) |
| Epson TM-m30III (112A0) | non précisé | CHF 230.95 port compris | idem |
| Epson TM-m30III-H noir ou blanc (C31CK51102A0 / C31CK51101A0, freecall24 AG) | non précisé | CHF 289.70 | idem |
| Epson TM-m30III-H WLAN + Bluetooth (C31CK51142A0) | WLAN, Bluetooth | CHF 319.00 (freecall24) ; CHF 324.35 (orderflow.ch) | idem |
| Epson TM-m30III marque SumUp (ofrex.ch) | USB, Bluetooth, WLAN | CHF 303.00 | idem |

- Toppreise affiche aussi un « mC-Print3 noir » à CHF 150.00 sans référence ni connectique : prix anormalement bas, à ne pas retenir sans contrôle — [Toppreise, mC-Print3](https://www.toppreise.ch/browse?q=Star+Micronics+mC-Print3)
- Le modèle standard TM-m30III existe en version « USB + LAN » (référence C31CK50401 en Inde) — [Epson India, TM-m30III USB+LAN](https://www.epson.co.in/For-Work/Printers/POS-Printers/Epson-TM-m30III-Thermal-Receipt-POS-Printer%28USB%2BLAN%29/p/C31CK50401)
- Prix de référence hors Suisse (non convertis) : Epson TM-m30III dès 236.27 € (Allemagne, 31 offres, relevé du 2.11.2026) — [Geizhals](https://geizhals.de/epson-tm-m30iii-c31ck50112-a2999407.html) ; Star TSP143IV 253.33 € hors TVA — [Delfi](https://shop.delfi.com/de/artikel/star-micronics-thermal-tsp143iv-ue-80mm-wide-paper-24vdc-internal-power-supply-cutter) ; Sunmi NT311 249.95 € (LDLC) et £214.72 TTC (ERS) — [LDLC](https://www.ldlc.com/sunmi/bint000040932/) ; [ERS Online](https://ers-online.co.uk/o30322/c04004005-sunmi-80mm-thermal-receipt-printer-with-cloud-compatibility)

### Inferences
- Pour un système maison sur Netlify, Star CloudPRNT est le plus simple : l'imprimante fait un POST toutes les 5 secondes vers une fonction serverless qui répond s'il y a un ticket en attente. Il faut un stockage persistant de la file (base ou Netlify Blobs) car une fonction serverless ne garde pas d'état. Deux imprimantes = deux URL ou deux identifiants (adresse MAC envoyée par l'imprimante), chacune ne recevant que ses lignes (cuisine ou pizza).
- Epson SDP fonctionne sur le même principe et le TM-m30III est le moins cher en Suisse (dès CHF 207.70), mais la documentation développeur est moins accessible que celle de Star.
- Configuration conseillée pour La Ferme : deux imprimantes Ethernet (Star MCP31CI dès CHF 257.38 chacune, ou Epson TM-m30III USB+LAN), soit environ CHF 515 à 535 pour la paire en Star, hors papier et câbles. Calcul fait à partir des prix ci-dessus.
- PrintNode ajoute un ordinateur toujours allumé sur place, ce qui va contre l'objectif « sans PC ». Sunmi est à écarter pour du sur-mesure faute d'API serveur documentée.

### Gaps
- Prix CHF sur digitec.ch, galaxus.ch et brack.ch : non vérifiés (pages Digitec en délai dépassé, aucune fiche Galaxus.ch ou Brack lue).
- Star TSP143IV / TSP100IV : aucun prix CHF trouvé.
- Sunmi NT311 : aucun prix CHF trouvé, aucune API cloud serveur documentée trouvée ; terminaux Sunmi T2/V2 non étudiés.
- Epson TM-m30II et TM-T20IV : prise en charge de Server Direct Print non vérifiée.
- Epson ePOS SDK depuis le navigateur d'une tablette (impression locale en réseau) : non documenté dans cette recherche.
- Connectique exacte des variantes TM-m30III « -H » : non précisée sur Toppreise.

## 2. Solutions de commande en ligne : multi-imprimantes, routage par catégorie, impression à l'acceptation

### Takeaway
Seules deux solutions documentent clairement le routage par catégorie vers plusieurs imprimantes : Lightspeed Restaurant K-Series (centres de production liés aux groupes comptables) et storekit (« split printing » par catégorie sur Star CloudPRNT, solution britannique). Flipdish, MENU TIGER et SIDES gèrent plusieurs imprimantes sans routage par catégorie documenté. GloriaFood, Wix, orderbird, Yoordi, Deliverect et Pikit : routage par catégorie non documenté.

### Cited Findings

| Solution | Plusieurs imprimantes | Routage par catégorie | Impression automatique | Matériel / prérequis | Source |
|---|---|---|---|---|---|
| Lightspeed Restaurant K-Series | Oui, un centre de production par imprimante tickets | Oui : « Only items that are in an accounting group with a production center will print order tickets. » | Oui pour la caisse ; pour les commandes en ligne, non documenté sur la page | Epson, Star et autres | [Lightspeed K-Series, About printing](https://k-series-support.lightspeedhq.com/hc/articles/1260804606770-About-printing) |
| storekit (Royaume-Uni) | Oui, deux minimum pour le split | Oui : catégorie > onglet Printing > cocher les imprimantes ; une catégorie sans imprimante sort sur toutes | Non précisé (à la réception ou à l'acceptation) | Star CloudPRNT, Ethernet recommandé | [storekit, Split printing](https://storekit.com/docs/guides/printing/split-printing) ; [storekit, Connect printing](https://storekit.com/docs/getting-started/launch/connect-printing) |
| Flipdish | Oui : « you can have multiple printers attached to one store » | Non documenté | Oui : peut accepter automatiquement et imprimer aussitôt | Star CloudPRNT : TSP654II, TSP143IV, SP742, mC-Print3 | [Flipdish, Star Micronics integration](https://help.flipdish.com/en/articles/9585229-flipdish-star-micronics-printer-integration) |
| MENU TIGER | Oui, par appareil et par établissement | Non : imprimantes attribuées aux magasins, pas aux catégories | Oui, à la commande ; à l'acceptation non précisé | Ordinateur Mac ou Windows avec serveur d'impression, pas de tablette ; option 20 $/mois | [MENU TIGER, printer setup](https://menutiger.helpscoutdocs.com/article/251-how-to-setup-printer-integration-in-menu-tiger) |
| Wix Restaurants Orders (nouvelle app) | Non documenté | Non documenté ; gabarit « Kitchen » (plats, quantités, remarques) | Oui, si l'app est ouverte | Thermiques Star et Epson, ou impression par e-mail en A4 | [Wix, About printing online orders (new)](https://support.wix.com/en/article/wix-restaurants-printing-an-order-in-the-new-restaurants-orders-app) |
| GloriaFood | Non documenté par GloriaFood | Non documenté ; un utilisateur l'a fait via SambaPOS, pas GloriaFood | Acceptation automatique possible vers une caisse (Oracle Simphony) | App GloriaFood ; intégrations tierces Star CloudPRNT et Epson SDP via Sinqro (prix non publié) | [Oracle, GloriaFood auto accept](https://docs.oracle.com/en/industries/food-beverage/simphony/simgi/t_gf_auto_accept_orders.htm) ; [SambaPOS forum](https://forum.sambapos.com/t/printing-gloriafood-pickup-orders-to-kitchen-and-orders-not-appearing-in-delivery-entity-screen-in-sambapos/20757) ; [Sinqro](https://www.sinqro.com/compatibility/gloriafood+star_cloudprnt) |
| SIDES (get-sides.de) | Imprimantes déclarées dans Hardware & System | Non documenté | Non documenté | Logiciel SOCP sur un ordinateur, transmission HTTPS ou SQS | [SIDES, SOCP Update](https://support.get-sides.de/portal/en/kb/articles/socp-update-en) |
| orderbird (QR / commande) | La caisse gère cuisine et bar en parallèle | Commandes QR : une seule imprimante choisie, routage non documenté | Non documenté | Imprimantes réseau configurées dans orderbird PRO | [orderbird, QR-Code Drucker verbinden](https://orderbirdpro.helpjuice.com/en_US/qr-code-bestellsystem-drucker-verbinden) ; [Macwelt](https://www.macwelt.de/article/954340/orderbird-ipad-als-kassensystem.html) |
| Deliverect | Dépend de la caisse hôte | Non documenté chez Deliverect, géré par la caisse | Dépend de la caisse | Agrégateur qui pousse vers la caisse | [Foodics, Deliverect](https://foodics.com/portfolio/deliverect) |
| Yoordi (Zurich) | Non documenté | Non documenté | Non documenté | Caisse iPad, iPhone, Android | [Igeho 2023, Yoordi](https://www.igeho.ch/en/c/discover-the-future-of-cash-register-systems-the-new-yoordi-cash-register.34432) |
| Pikit (Suisse) | Non documenté | Non documenté ; « tickets cuisine au format 80 mm » mentionnés | Non documenté | Dès CHF 89/mois TTC, lancement annoncé fin septembre 2026 | [La Télé, Pikit](https://latele.ch/articles/pikit-la-commande-en-ligne-sans-commission-pour-les-restaurants-suisses) |
| Shopify (Zapiet, Order Printer Pro, etc.) | Non documenté | Non documenté ; question CloudPRNT sans réponse sur le forum | Non documenté | — | [Shopify Community](https://community.shopify.com/t/printer-compatiblity/355013) |

Compléments :
- Lightspeed Order Anywhere (gamme Restaurant Manager) : « Automatically accept and finalize » n'est pas pris en charge, il faut « Automatically accept », qui envoie les commandes en cuisine ou au bar dès leur arrivée — [Lightspeed Restaurant Manager](https://resto-support.lightspeedhq.com/hc/articles/4411463548443) (via résultat de recherche). Gamme O-Series : sans « Pass-Thru Printing », chaque commande en ligne doit être acceptée sur la caisse avant d'imprimer — [Lightspeed O-Series](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329349632155-My-Online-Orders-didn-t-complete-automatically-are-locked-on-my-POS) (via résultat de recherche).
- Chez K-Series, les commandes de partenaires (Wolt) s'impriment selon le profil d'impression défini à l'installation — [Venture Unicorns, Wolt to K-Series](https://venture-unicorns.helpscoutdocs.com/article/39-wolt-to-lightspeed-k-series-setup)
- Un concurrent (storekit) affirme que GloriaFood ferme et que le support ne répond plus depuis janvier 2025 : affirmation commerciale, non vérifiée auprès de GloriaFood — [storekit, GloriaFood printers](https://gloria-food.storekit.com/blog/gloriafood-printers)

### Inferences
- Lightspeed K-Series est la seule solution grand public qui couvre le besoin complet (catégorie « Pizzas » vers l'imprimante pizza, le reste vers la cuisine), mais elle remplace la caisse actuelle de La Ferme et le passage des commandes en ligne dans les centres de production n'est pas documenté noir sur blanc.
- storekit fait exactement le routage voulu sur Star CloudPRNT, mais sa disponibilité et ses prix en Suisse ne sont pas vérifiés.
- Pour Flipdish, Wix, GloriaFood ou MENU TIGER, il faudrait doubler le ticket complet sur deux imprimantes au mieux : la station pizza recevrait aussi la charbonnade.
- Un système maison (Netlify + CloudPRNT) reproduit le « split printing » de storekit : à l'acceptation, la fonction découpe la commande par catégorie et crée deux tâches, une par imprimante.

### Gaps
- Lightspeed K-Series : impression des commandes en ligne (Order Anywhere ou boutique en ligne) dans les centres de production, et prix suisse : non vérifiés.
- storekit : disponibilité en Suisse, prix, déclenchement à l'acceptation : non vérifiés.
- GloriaFood : aucune page d'aide officielle sur le multi-imprimantes trouvée ; statut du service en 2026 non vérifié.
- Yoordi, Pikit, Deliverect, SIDES, Shopify, Wix : routage par catégorie non documenté.
- Pikit : le lancement était annoncé pour fin septembre 2026, statut au 3.11.2026 non vérifié.
