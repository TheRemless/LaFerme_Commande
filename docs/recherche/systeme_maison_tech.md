# Système de commande « maison » pour La Ferme (Onex) : briques techniques et coûts réels

Toutes les pages ont été consultées le 3 novembre 2026. Hypothèse de volume donnée par le brief : 170 commandes par mois à 35 CHF de moyenne, soit 5 950 CHF par mois.
Légende : « non publié » = absent de la source officielle ; « non vérifié » = chiffre trouvé seulement chez un tiers ou dans un extrait de recherche sans lecture de la page source.

## 1. Frais par transaction TWINT et cartes : Stripe CH, Payrexx, Datatrans et autres

### Takeaway
Payrexx (abo Standard) est le moins cher par commande : TWINT 1,25 % + 0,18 CHF et cartes 1,65 % + 0,18 CHF, contre 1,9 % + 0,30 CHF (TWINT) et 2,9 % + 0,30 CHF (cartes suisses) chez Stripe. Datatrans (Planet) impose un minimum de 190 EUR par mois, hors de proportion pour 170 commandes.

### Cited Findings

**Stripe Suisse (tarif Standard)**
- TWINT : 1,9 % + 0,30 CHF ; +2 % si conversion de devise — [Stripe, moyens de paiement locaux CH](https://stripe.com/en-ch/pricing/local-payment-methods) (consulté le 3.11.2026)
- Cartes suisses : 2,9 % + 0,30 CHF ; cartes internationales : 3,25 % + 0,30 CHF ; +2 % si conversion de devise — [Stripe pricing CH](https://stripe.com/ch/pricing) et [page moyens locaux](https://stripe.com/en-ch/pricing/local-payment-methods) (3.11.2026)
- Tarif spécifique « cartes EEE » en ligne : non publié sur la page (la page cite 1,4 % + 0,10 CHF EEE et 2,9 % + 0,10 CHF hors EEE uniquement pour le paiement en personne Terminal) — [Stripe pricing CH](https://stripe.com/ch/pricing) (3.11.2026)
- Litige reçu : 20 CHF ; réponse à un litige : 20 CHF (remboursés si gagné) ; 3D Secure sur plan Custom : 0,03 CHF par tentative — [Stripe pricing CH](https://stripe.com/ch/pricing) (3.11.2026)
- Frais de versement (payout) standard : non publiés sur les pages consultées ; seuls les « multi-currency payouts » sont à 1 % — [Stripe pricing CH](https://stripe.com/ch/pricing) (3.11.2026)
- TWINT via Stripe : montant minimum 0,50 CHF, maximum 5 000 CHF ; client en Suisse, devise CHF ; confirmation immédiate ; règlement selon le calendrier de versement standard ; remboursements partiels et totaux jusqu'à 180 jours ; Checkout, Payment Links et Payment Element supportés, Express Checkout Element non supporté — [Stripe Docs TWINT](https://docs.stripe.com/payments/twint) (3.11.2026)
- Conditions d'activation TWINT chez Stripe : site public fonctionnel, prix affichés en CHF, mentions légales avec raison sociale, forme juridique, adresse complète, CGV, e-mail ou téléphone de contact ; capacité « twint_payments » en attente jusqu'à vérification — [Stripe Docs TWINT](https://docs.stripe.com/payments/twint) (3.11.2026)

**Payrexx (page CH)**
- Online, abo Free : TWINT 1,30 % + 0,30 CHF ; Visa/Mastercard 2,50 % + 0,30 CHF — [Payrexx Preise de-CH](https://www.payrexx.com/de-ch/preise/) (3.11.2026)
- Online, abo Standard : TWINT 1,25 % + 0,18 CHF ; Visa/Mastercard 1,65 % + 0,18 CHF — [Payrexx Preise de-CH](https://www.payrexx.com/de-ch/preise/) (3.11.2026)
- Online, abo Premium : TWINT 1,25 % + 0,18 CHF ; Visa/Mastercard 1,35 % + 0,18 CHF — [Payrexx Preise de-CH](https://www.payrexx.com/de-ch/preise/) (3.11.2026)
- Apple Pay, Google Pay, Samsung Pay : mêmes taux que Visa/Mastercard. Cartes business et internationales : 3,40 % + 0,18 CHF ; AMEX/Discover/Diners business et internationales : +1,00 % — [Payrexx Preise de-CH](https://www.payrexx.com/de-ch/preise/) (3.11.2026)
- Si on branche un PSP externe (ex. Stripe) dans Payrexx : +1,00 % (Free), +0,50 % (Standard), +0,25 % (Premium) — [Payrexx Preise de-CH](https://www.payrexx.com/de-ch/preise/) (3.11.2026)
- Prix mensuel des abos : le montant n'apparaît pas dans le contenu lisible de la page (rendu JavaScript) ; essai gratuit 30 jours pour tous les abos ; prix hors TVA — [Payrexx pricing en-CH](https://www.payrexx.com/en-ch/pricing/) (3.11.2026)
- Abo Standard à 19 CHF par mois (remise 10 % sur 2 ans, 20 % sur 3 ans) : non vérifié (extrait de recherche de la page payrexx.com/en/prices, non confirmé par lecture directe) — [Payrexx prices](https://payrexx.com/en/prices)
- Prix de l'abo Premium : non vérifié / non lisible
- Frais de mise en service : non mentionnés. Versement : hebdomadaire par défaut, quotidien sur demande, frais non mentionnés — [Payrexx pricing en-CH](https://www.payrexx.com/en-ch/pricing/) (3.11.2026)

**Datatrans (désormais Planet)**
- datatrans.ch/en/pricing redirige vers datatrans.weareplanet.com/pricing — (3.11.2026)
- Plans en EUR : « Get Started » prix non affiché ; « Scale Now » 20 EUR par mois + 0,25 EUR par transaction ; « Enterprise » 120 EUR par mois + 0,25 EUR par transaction — [Planet/Datatrans pricing](https://datatrans.weareplanet.com/pricing) (3.11.2026)
- « Planet Acquiring » facturé à part des plans ; minimum mensuel de 190 EUR si le volume n'atteint pas ce montant ; TWINT et frais de mise en service non mentionnés — [Planet/Datatrans pricing](https://datatrans.weareplanet.com/pricing) (3.11.2026)
- Ancienne grille CHF (20 CHF « Get Started », 125 CHF « Scale Now », 1,60 % + 0,29 CHF) : non vérifié, source concurrente Payrexx, contredite par la page officielle actuelle en EUR — [Payrexx, comparatif Datatrans](https://payrexx.com/en-ch/comparison/datatrans-vs-paypal)

**Wallee**
- Basic 19,95 CHF par mois ; Visa/Mastercard 1,55 % + 0,20 CHF ; Business 69,90 CHF par mois, 1,55 % + 0,12 CHF ; mise en service gratuite : non vérifié (sources : comparatifs Payrexx, concurrent, avec chiffres parfois incohérents entre pages) — [Payrexx, wallee vs Stripe](https://www.payrexx.com/en/comparison/wallee-vs-stripe) ; page officielle wallee non consultée

**Saferpay (Worldline)**
- 19,90 CHF par mois, dès 0,17 CHF par transaction, mise en service 0 CHF (frais de passerelle ; l'acquiring cartes est un contrat séparé) : non vérifié (extrait de recherche de la page Worldline CH, plan non nommé) — [Worldline Saferpay de-CH](https://worldline.com/de-ch/home/main-navigation/solutions/merchants/solutions-and-services/e-commerce/saferpay-payment-solution.html)
- Grille PDF officielle Saferpay CH : lien renvoie 404 le 3.11.2026 — [PDF Worldline](https://worldline.com/content/dam/worldline/local/en-ch/documents/110023002-ds-saferpay-price-list-che-en-opt.pdf)

**SumUp (paiement en ligne)**
- SumUp ne propose pas TWINT selon plusieurs sources tierces ; cartes en ligne 2,50 % : non vérifié (sources Payrexx, concurrent) — [Payrexx, Worldline vs SumUp](https://payrexx.com/en-ch/guides/worldline-vs-sumup-kartenterminal-schweiz) ; page officielle SumUp CH non consultée

**TWINT en direct (contrat TWINT Acquiring)**
- Pages officielles twint.ch (tarifs, PDF « Preis- und Leistungsverzeichnis » V1.2 août 2026) : accès refusé (HTTP 403) le 3.11.2026 — [TWINT Acquiring prix](https://www.twint.ch/en/business-customers/twint-acquiring/prices/) ; [PDF V1.2 FR](https://www.twint.ch/content/uploads/2026/08/Preis-und-Leistungsverzeichnis-FR-V1-2.pdf)
- Lien de paiement TWINT : 1,35 % du montant + 0,30 CHF par paiement : non vérifié (extrait de recherche de la page officielle) — [TWINT payment link](https://www.twint.ch/en/business-customers/products/twint-for-online-shops/payment-link/)
- Grille V1.2 : 1,30 % présentiel, 1,35 % à distance, +0,30 CHF pour une facture TWINT : non vérifié (extraits de recherche, version précédente V1.1 citait 1,30 % à distance) — [PDF V1.2 DE](https://www.twint.ch/content/uploads/2026/08/Preis-und-Leistungsverzeichnis-DE-V1-2.pdf)
- Contexte : la faîtière du commerce réclame des frais TWINT plus bas (août 2026) — [Netzwoche, 24.08.2026](https://www.netzwoche.ch/news/2026-08-24/handelsverband-verlangt-tiefere-twint-gebuehren)

**Paiement à la livraison / au retrait**
- Aucune source consultée n'interdit le paiement en espèces ou au comptoir à la remise ; Stripe et Payrexx ne l'imposent pas (inférence, pas de source juridique lue).

### Inferences
- Coût par commande de 35 CHF (calcul sur les taux cités) :

| Prestataire | TWINT | Carte suisse |
|---|---|---|
| Stripe | 0,965 CHF (2,76 %) | 1,315 CHF (3,76 %) |
| Payrexx Free | 0,755 CHF (2,16 %) | 1,175 CHF (3,36 %) |
| Payrexx Standard | 0,6175 CHF (1,76 %) | 0,7575 CHF (2,16 %) |
| Payrexx Premium | 0,6175 CHF | 0,6525 CHF |
| TWINT lien de paiement direct (non vérifié) | 0,7725 CHF | sans objet |

- Coût mensuel paiement pour 170 commandes, mix supposé 60 % TWINT / 40 % cartes suisses (102 / 68) :
  - Stripe : 98,43 + 89,42 = **187,85 CHF** (3,16 % du CA), aucun abonnement.
  - Payrexx Free : 77,01 + 79,90 = **156,91 CHF** (abo Free supposé à 0 CHF, montant non lisible).
  - Payrexx Standard : 62,99 + 51,51 = 114,50 CHF + abo 19 CHF (non vérifié) = **133,50 CHF** (2,24 % du CA).
  - Datatrans/Planet : minimum 190 EUR par mois + acquiring séparé, donc écarté.
- Écart Stripe vs Payrexx Standard : environ 54 CHF par mois, soit environ 650 CHF par an à ce volume. Stripe reste le plus simple à coder (Checkout + webhook, doc Claude Code abondante) ; Payrexx a aussi une API et des liens de paiement, mais la qualité de son SDK n'a pas été évaluée ici.
- Mettre le paiement en ligne obligatoire réduit les commandes fantômes ; garder « payer au retrait » réduit les frais mais pas pour la livraison (risque de non-paiement).

### Gaps
- Prix mensuel exact des abos Payrexx Free/Standard/Premium : non lisible sur la page officielle (JavaScript).
- Grille officielle TWINT direct, Saferpay et wallee : pages ou PDF inaccessibles (403/404) ou non consultés.
- Frais de versement Stripe vers compte bancaire suisse : non publiés sur les pages lues.
- TVA sur les frais Stripe : non vérifié.
- Tarif Stripe « cartes EEE en ligne » : non publié sur la page CH.

## 2. Backend : Netlify Functions et alternatives

### Takeaway
Netlify facture désormais en crédits : 300 crédits gratuits par mois et un site mis en pause en cas de dépassement sur Free. À 15 crédits par déploiement de production, 20 déploiements suffisent à épuiser le Free ; le plan Personal à 9 USD (1 000 crédits) est la marge de sécurité réaliste.

### Cited Findings
- Free 0 USD, limite 300 crédits ; Personal 9 USD par mois, 1 000 crédits ; Pro 20 USD par mois, 3 000 crédits ; packs : 500 crédits pour 5 USD (Personal), 1 500 crédits pour 10 USD (Pro) — [Netlify pricing](https://www.netlify.com/pricing/) (3.11.2026)
- Consommation : déploiement de production 15 crédits ; calcul 10 crédits par Go-heure ; bande passante 20 crédits par Go ; requêtes web 2 crédits par 10 000 ; IA 180 crédits par USD — [Netlify pricing](https://www.netlify.com/pricing/) et [Netlify docs, crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) (3.11.2026)
- Les fonctions ne sont pas facturées à l'invocation : calcul = mémoire × durée ; deploy previews et branch deploys 0 crédit ; formulaires Netlify Forms gratuits et illimités sur les plans à crédits — [Netlify docs, crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) (3.11.2026)
- Free : limite dure, pas d'achat de crédits ; une fois épuisés, tous les projets sont mis en pause (« Site not available ») ; allocation remise à zéro à chaque cycle mensuel — [Netlify docs, crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) (3.11.2026)
- Netlify Blobs et « Netlify Database » inclus dans le Free ; tarif crédit spécifique Blobs non publié sur la page crédits — [Netlify pricing](https://www.netlify.com/pricing/) (3.11.2026)
- Cloudflare Workers Free : 100 000 requêtes par jour, 10 ms CPU par invocation ; Workers Paid minimum 5 USD par mois ; KV gratuit 100 000 lectures et 1 000 écritures par jour, 1 Go ; D1 gratuit 5 millions de lignes lues et 100 000 écrites par jour, 5 Go — [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (3.11.2026)

### Inferences
- Charge des fonctions pour 170 commandes : quelques centaines d'appels (création de session de paiement, webhook, statut) à moins d'une seconde chacun à 1 Go, soit bien moins de 1 Go-heure, donc moins de 10 crédits par mois.
- Le vrai poste est le nombre de déploiements de production (chaque modif de carte.json = 15 crédits) et la bande passante du site (photos). Exemple : 10 déploiements (150) + 5 Go (100) = 250 crédits, à la limite du Free.
- Ne pas redéployer pour l'état des commandes : stocker les commandes hors du build (Blobs ou base externe).
- Cloudflare Workers + D1 couvrirait tout gratuitement mais oblige à sortir de l'écosystème Netlify existant.

### Gaps
- Limites précises de taille et de durée d'exécution des Netlify Functions en 2026 : non consultées.
- Tarif Firebase (plan Spark) : non consulté.

## 3. Base de données

### Takeaway
Supabase Free suffit largement en volume (500 Mo) mais met le projet en pause après une semaine d'inactivité ; Netlify Blobs ou Cloudflare D1 évitent ce risque pour 170 commandes par mois.

### Cited Findings
- Supabase Free : 500 Mo de base par projet, 50 000 utilisateurs actifs mensuels, 5 Go d'egress + 5 Go en cache, 500 000 invocations Edge Functions par mois, 2 projets actifs, pause après 1 semaine d'inactivité ; Pro dès 25 USD par mois — [Supabase pricing](https://supabase.com/pricing) (3.11.2026)
- Netlify Blobs inclus dans le plan Free Netlify — [Netlify pricing](https://www.netlify.com/pricing/) (3.11.2026)
- Cloudflare D1 Free : 5 Go, 100 000 lignes écrites par jour — [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (3.11.2026)

### Inferences
- 170 commandes par mois à environ 2 Ko par commande = moins de 5 Mo par an : n'importe quelle option gratuite tient.
- Un restaurant reçoit des commandes chaque semaine, donc la pause Supabase ne devrait pas se déclencher en saison ; elle reste un risque en cas de fermeture annuelle (vacances).

### Gaps
- Airtable et Google Sheets (limites API, plan gratuit) : non consultés.

## 4. Notifications au restaurant

### Takeaway
Telegram (bot gratuit) ou un e-mail transactionnel gratuit couvrent le besoin ; un SMS de secours via Twilio coûterait environ 13 USD par mois pour 170 SMS, moins cher via ASPSMS (9 ct par crédit).

### Cited Findings
- Twilio Suisse : SMS sortant vers mobile 0,0769 USD par segment ; entrant 0,0075 USD ; numéro mobile 11,70 USD par mois ; Alphanumeric Sender ID gratuit ; frais opérateur additionnels possibles ; 0,001 USD par message échoué — [Twilio SMS pricing CH](https://www.twilio.com/en-us/sms/pricing/ch) (3.11.2026)
- ASPSMS : crédits prépayés sans expiration ; 500 crédits = 45 CHF (9 ct par crédit) ; 1 crédit par SMS vers Swisscom, 1,75 crédit vers Salt ; Sunrise passe de 1 à 1,75 crédit au 1er août 2026 : non vérifié (extraits de newsletters ASPSMS, page de prix non lue) — [ASPSMS prix](https://www.aspsms.com/en/prices/) ; [newsletter 30.06.2026](https://www.aspsms.com/en/newsletter/20260630/)
- Resend Free : 3 000 e-mails par mois, plafond 100 par jour, 1 domaine : non vérifié (sources tierces) — [freetier.co, Brevo vs Resend](https://freetier.co/compare/brevo-vs-resend)
- Brevo Free : 300 e-mails par jour — [Brevo help center](https://help.brevo.com/hc/en-us/articles/208580669) (limite quotidienne confirmée, chiffre via sources tierces : non vérifié)
- WhatsApp Business Platform : facturation par message livré selon catégorie et pays ; messages « utility » payants même dans la fenêtre de service à partir d'octobre 2026 ; tarif Suisse « utility » : environ 0,0171 USD selon un calculateur tiers, non vérifié — [Meta, pricing](https://developers.facebook.com/docs/whatsapp/pricing) ; [whautomate](https://whautomate.com/tools/whatsapp-business-api-pricing-calculator)
- eCall, websms : non consultés.

### Inferences
- 170 SMS Twilio = 13,07 USD par mois (sans numéro, avec Sender ID alphanumérique).
- 170 SMS ASPSMS vers Swisscom = 15,30 CHF ; vers Salt/Sunrise à 1,75 crédit = 26,78 CHF (non vérifié).
- Un bot Telegram vers le téléphone du restaurant + un e-mail au client est la combinaison à 0 CHF ; l'imprimante cloud sert déjà d'alerte en cuisine.

### Gaps
- Gratuité de l'API Telegram Bot : non vérifiée dans cette session (aucune page lue).
- Pages de prix officielles Resend, Postmark, Brevo non lues.

## 5. Imprimantes de tickets cuisine

### Takeaway
Star CloudPRNT (mC-Print3, TSP143IV) interroge le serveur en HTTP/JSON et fonctionne avec une simple fonction serverless ; prix suisses non trouvés chez digitec/Brack, comptez environ 240 à 420 EUR/CHF selon modèle (prix européens).

### Cited Findings
- Star CloudPRNT : l'imprimante envoie périodiquement un POST JSON à une URL unique, récupère le ticket par GET, confirme par DELETE ; variante MQTT documentée ; guide de protocole v2.5.2 du 12.09.2025 — [Star CloudPRNT Protocol Guide](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/http-method-reference/index.html) (extrait de recherche, 3.11.2026)
- CloudPRNT de nouvelle génération inclus en standard sur tous les mC-Print — [Star EMEA mC-Print3](https://star-emea.com/products/mc-print3/) (extrait de recherche)
- Star mC-Print3 : prix conseillé 401,32 EUR ; successeur MCP31 à 542,44 EUR chez Jarltech — [Jarltech](https://www.jarltech.com/en/star-mc-print3) (extrait de recherche, 3.11.2026)
- Star TSP143IV : environ 286 EUR pour une variante — [Barcodesite](https://www.barcodesite.eu/star-tsp100iv-39473790.html) (extrait de recherche)
- Epson TM-m30III : 264 CHF (Ethernet, Bluetooth, USB-C, WLAN), 269 CHF et 237 CHF selon variantes sur digitec.ch, mais page de catégorie « secondhand » donc état neuf/occasion non vérifié — [digitec, Belegdrucker](https://www.digitec.ch/de/s1/secondhand/producttype/belegdrucker-3060)

### Inferences
- CloudPRNT colle à l'architecture Netlify : une fonction répond au polling de l'imprimante et sert les commandes en attente, sans PC ni tablette au restaurant. Coût en crédits Netlify : polling toutes les 5 à 10 s pendant les heures d'ouverture = environ 100 000 à 200 000 requêtes par mois, soit 20 à 40 crédits en requêtes web plus le calcul.
- Alternative la moins chère : une tablette Android avec une page web d'administration qui sonne à chaque commande (prix non relevé).

### Gaps
- Prix CHF neufs chez digitec/Brack pour Star mC-Print3 et TSP143IV : non trouvés.
- Epson Server Direct Print sur TM-m30III, PrintNode (abonnement) : non vérifiés.
- Prix d'une tablette Android d'entrée de gamme en Suisse : non relevé.

## 6. Autres briques et coût mensuel réaliste pour 170 commandes

### Takeaway
Hors matériel, le système maison coûte environ 135 à 190 CHF par mois, dont plus de 95 % en frais de paiement ; l'hébergement et les notifications peuvent rester à 0 ou 9 USD.

### Cited Findings
- Taux de paiement et abonnements : voir section 1 (sources Stripe et Payrexx du 3.11.2026).
- Netlify Personal 9 USD par mois — [Netlify pricing](https://www.netlify.com/pricing/) (3.11.2026)
- Supabase Free 0 USD — [Supabase pricing](https://supabase.com/pricing) (3.11.2026)
- Twilio SMS 0,0769 USD — [Twilio SMS pricing CH](https://www.twilio.com/en-us/sms/pricing/ch) (3.11.2026)

### Inferences
- Budget mensuel (CA 5 950 CHF, mix 60 % TWINT / 40 % cartes) :

| Poste | Option économique | Option confort |
|---|---|---|
| Paiement | Payrexx Standard 133,50 CHF (abo non vérifié) | Stripe 187,85 CHF |
| Hébergement | Netlify Free 0 | Netlify Personal 9 USD |
| Base | Netlify Blobs ou Supabase Free 0 | idem |
| Notif. restaurant | Telegram 0 (non vérifié) | + SMS Twilio 13,07 USD |
| E-mail client | Resend ou Brevo Free 0 (non vérifié) | idem |
| **Total mensuel** | **≈ 134 CHF (2,2 % du CA)** | **≈ 188 CHF + 22 USD (≈ 3,5 % du CA)** |

- Investissement unique : imprimante cloud environ 240 à 420 (CHF/EUR, voir section 5) ou tablette déjà possédée.
- Zones de livraison : une liste fixe de NPA genevois en JSON (Onex 1213 et voisins) évite toute API de géolocalisation payante (inférence ; pas de source tarifaire Google Maps consultée).
- Domaine : restaurantlaferme.ch existe déjà, aucun coût additionnel.

### Gaps
- Tarifs Google Maps Distance Matrix et liste officielle NPA (Poste/opendata.swiss) : non consultés.
- Taux de change USD/CHF non fixé : totaux laissés en USD pour les postes facturés en dollars.
