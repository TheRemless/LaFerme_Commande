# Commande en ligne pour La Ferme (Onex) : comparatif et recommandation

Recherche arrêtée à ta demande. Les notes sources sont dans `/Users/admin/Library/Application Support/Claude/scratch-workspaces/e478ae07-7565-4d6b-8249-ecd08e85e21d/5327860a-f143-40a1-9828-df6eed5ec448/scratch-2026-11-03-a43432/research_notes/Commande en ligne La Ferme/` (8 fichiers). Toutes les pages ont été consultées le 3.11.2026, les renvois [n] pointent vers la liste en fin de rapport. Les options sur les plats (ajout ou retrait d'ingrédients) n'ont pas pu être recherchées. Elles sont donc marquées « non vérifié » pour toutes les solutions du marché.

## Corrections à connaître avant de choisir

| Piste citée | Constat |
|---|---|
| Smood | Fermé le 30.4.2026, 427 emplois touchés dont 236 à Genève [4] |
| GloriaFood | Fin de service annoncée le 30.4.2027 sur gloriafood.com, Oracle renvoie vers FoodAmigos [5] |
| Square, Owner.com | Non disponibles en Suisse. Square ne liste pas la Suisse, Owner.com vise les États-Unis [21] |
| Mr. Ordr | Introuvable, le domaine mrordr.ch n'existe pas. Le nom exact est à faire préciser |
| Lunchgate / foratable | Réservation de tables seulement, pas de commande à emporter ni de livraison |
| Datatrans | Devenu Planet. Minimum de 190 EUR par mois, donc hors sujet à ce volume [24] |
| SumUp | TWINT non pris en charge selon deux sources concurrentes (non vérifié auprès de SumUp) [12] |
| Pikit (romand) | Lancement annoncé fin septembre 2026 [10]. Le site affiche « officiellement lancé » [9] mais il n'y a aucun recul |

## 1. Uber Eats en Suisse (référence)

Grille officielle [1], page non datée (« © 2026 ») :

| Formule Uber Eats CH | Commission | Commandes Uber One |
|---|---|---|
| Léger (coursiers Uber) | 32 % | 35 % |
| Standard (livreurs du restaurant) | 15 % | 13 % |
| À emporter | 15 % | non indiqué |

S'y ajoutent 600 CHF d'activation unique et aucun abonnement. Le traitement des paiements est présenté comme inclus. La TVA sur la commission n'est pas publiée. En 2020, la RTS parlait de 30 % plus TVA [3]. Les blogs qui annoncent 6 % ou 20 à 30 % sont contredits par la page officielle.

Pour comparer, d'autres plateformes. Just Eat (ex-eat.ch) ne publie rien. Un concurrent l'estime de 10 à 15 % en livraison propre et de 25 à 30 % avec ses coursiers (non vérifié) [41]. La présence de Wolt à Genève n'est pas vérifiée.

## 2. Tableau comparatif des solutions

Abréviations. Préco = commande à l'avance quand c'est fermé. Paiement livr. = cash ou carte au livreur. Routage = impression automatique à l'acceptation sur deux imprimantes avec tri par catégorie.

| Solution | Modèle | Commission | Abonnement | TWINT en ligne | Routage 2 imprimantes | Options ingrédients | Préco | Paiement livr. / retrait | Zones + minimum | Intégration site statique | Suisse |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Système maison** | Direct | 0 | infra de 0 à 30 CHF environ (voir §4) | Oui, via Stripe ou Payrexx [22][23] | Oui, à coder (CloudPRNT / Server Direct Print) [28] | Oui, à concevoir | Oui, à coder | Oui, à coder | Oui, par NPA ou commune | Natif, lit carte.json | Oui |
| **Pikit** | Direct | 0 | 89 / 139 / 199 CHF TTC, paiement en ligne seulement dans l'offre Max à 199 [9] | Oui (offre Max) [9] | Non documenté, tickets 80 mm cités [10] | Non vérifié | Non explicite | Oui, « à la remise » et « au livreur » [9] | Oui, par localité avec frais et minimum (dès l'offre Plus) [9] | Site autonome, lien | Oui, romand |
| **Lightspeed Restaurant + Order Anywhere** | Direct + caisse | « sans commission » (blog 2021, non vérifié) | Basic 89, Core 159, Pro 249 CHF. Order Anywhere en supplément sauf en Pro [6] | Oui en Suisse [7] | Oui en caisse (centres de production) [8]. Pour les commandes en ligne : non documenté | Non vérifié | Non documenté | Retrait payé sur place : oui [7]. Au livreur : non documenté | Oui, mais vu seulement sur la page Amérique du Nord | Lien ou QR code | Oui, bureau à Genève |
| **Wix Restaurants Orders** | Direct | 0 | Forfait Core 29.77 ou Business 39.77 par mois, prix affichés en USD, CHF non vérifié [14] | Contradictoire : natif à 1,9 % + 0.30 [13] ou via un fournisseur tiers selon une autre note | Non documenté | Non vérifié | Mode « Preorder only » : oui. Commande pendant la fermeture : non documenté | Paiement manuel (cash) : oui | Oui, par rayon ou dessin, frais et minimum par zone [13] | Site Wix séparé, lien | Oui |
| **Shopify + Zapiet Eats** | Direct | 0 (+2 % avec un prestataire externe en Basic) [15] | 29 CHF + Zapiet de 30 à 80 USD, prix contradictoires [15][16] | Listé dans Shopify Payments, tarif non publié | Non documenté | Non vérifié | Créneaux : oui. Préco quand fermé : non documenté | Non documenté | Oui, frais et minimum par zone [16] | Boutique séparée, lien | Oui |
| **Yoordi** (Zurich) | Direct + caisse | non publié | Caisse dès 63.20 CHF/mois. Webshop : prix non publié [11] | Oui [11] | Non documenté | Non vérifié | Non documenté | Non documenté | Non documenté | Lien | Oui |
| **Flipdish** | Direct | non publié | dès 99 EUR/mois [19] | Non documenté | Plusieurs imprimantes Star, sans routage par catégorie documenté | Non vérifié | Oui (« Always appear open ») [19] | Non documenté | Oui, par rayon ou polygone [19] | Lien | Non vérifié |
| **SIDES** (Berlin) | Direct | 0 | de 69 à 629 EUR/mois, sur devis [17] | Via SIDES Pay [17] | Logiciel sur PC, routage non documenté | Non vérifié | Non documenté | Non documenté | Non documenté | Non documenté | Cible la Suisse |
| **MENU TIGER** | Direct | 0 | de 0 à 119 USD/mois, plafond de commandes. Impression +20 USD, PC requis [18] | Non documenté | Sans routage documenté | Non vérifié | Non documenté | Cash, carte | Non documenté | Lien | Non vérifié |
| **GloriaFood** | Direct | 0 | Gratuit + 29 USD/mois pour le paiement en ligne (non vérifié) | Non documenté | Non documenté | Non vérifié | Oui | Cash et carte sur place | Oui | Widget | **Ferme le 30.4.2027** [5] |
| **orderbird** | Direct + caisse | 4 % selon trusted.de (non vérifié pour la Suisse) | non publié | Non vérifié | Une seule imprimante sélectionnable | Non vérifié | Non documenté | Non documenté | Non vérifié | Non publié | Oui |
| **ZunaPro** | Site + commande | non publié | 890 à 4 590 CHF/an ou 199 à 499 CHF/an selon les pages, contradictoire [43] | Oui | Non documenté | Non vérifié | Non documenté | Non documenté | Non documenté | Remplace le site | Oui |
| **storekit** (UK) | Direct | non vérifié | non vérifié | Non vérifié | Oui, « split printing » par catégorie sur Star [20] | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Lien | Non vérifié |
| **Uber Eats** | Marketplace | 15 % ou 32 % [1] | 0 (600 CHF d'activation) | Oui côté client | Tablette et imprimante Uber | Oui (constaté dans l'app, non sourcé) | Non vérifié | Non | Gérées par Uber | Non | Oui |

Aucune solution du marché ne lit carte.json. Avec n'importe laquelle, les 139 plats sont à ressaisir et à tenir à jour à deux endroits.

## 3. Coût mensuel à 10, 20 et 30 commandes par jour

Base : 50 CHF de panier, 26 jours. Cela donne 260, 520 et 780 commandes, soit 13 000, 26 000 et 39 000 CHF par mois.

Hypothèses, non vérifiées :
- 70 % des commandes sont payées en ligne. Le reste est payé au retrait ou au livreur, sur le terminal actuel dont les frais ne sont pas comptés.
- Les paiements en ligne se font à 60 % par TWINT et à 40 % par cartes suisses.
- Le salaire des livreurs n'est pas compté : il est le même dans toutes les options sauf Uber Eats Léger.

Frais par commande en ligne de 50 CHF :
- Stripe : 1.45 CHF (TWINT 1,9 % + 0.30, cartes 2,9 % + 0.30) [22].
- Payrexx Standard : 0.885 CHF (TWINT 1,25 % + 0.18, cartes 1,65 % + 0.18) [23]. L'abonnement de 19 CHF/mois n'est pas lisible sur la page officielle (non vérifié).

| Option | 10 cmd/jour | 20 cmd/jour | 30 cmd/jour |
|---|---|---|---|
| Uber Eats Léger (32 %) | 4 160 | 8 320 | 12 480 |
| Uber Eats Standard ou à emporter (15 %) | 1 950 | 3 900 | 5 850 |
| Maison + Stripe (+ environ 20 d'infra et SMS) | environ 285 | environ 550 | environ 810 |
| Maison + Payrexx Standard (+ environ 20) | environ 200 | environ 360 | environ 520 |
| Wix Business + Wix Payments (TWINT 1,9 %, cartes 2,3 %) | environ 280 | environ 525 | environ 765 |
| Pikit Max | 199 + frais de paiement non publiés | idem | idem |
| Lightspeed Pro | 249 + frais Lightspeed Payments non publiés | idem | idem |
| Shopify Basic + Zapiet (cartes seules, TWINT non publié) | environ 400 | environ 725 | environ 1 050 |

Tous les montants sont en CHF par mois et calculés par moi. Pour Pikit et Lightspeed, il faut ajouter des frais de paiement qui ne sont pas publiés. S'ils sont proches de ceux de Payrexx, l'ordre de grandeur va de 160 à 480 CHF de plus selon le volume (non vérifié).

Coûts uniques :
- Deux imprimantes de 210 à 330 CHF chacune [29], plus une tablette.
- Pour le système maison, le temps de développement de Jérémy, non chiffré.

Repère pour le livreur salarié. Le salaire minimum genevois est de 24,59 CHF brut de l'heure en 2026 [31]. Quatre heures par jour pendant 26 jours représentent environ 2 560 CHF brut par mois, hors charges sociales (calcul, charges non chiffrées).

## 4. Système maison : briques et coût

| Brique | Choix proposé | Coût publié |
|---|---|---|
| Paiement | Payrexx (moins cher dès environ 34 commandes en ligne par mois) ou Stripe (API plus simple) | voir §3 [22][23] |
| Backend | Netlify Functions | Free : 300 crédits. Personal : 9 USD. Un déploiement coûte 15 crédits et sur Free le site est mis en pause quand les crédits sont épuisés [25]. Prendre Personal |
| Données | Supabase Free (500 Mo, pause après 7 jours d'inactivité) ou Netlify Blobs | 0 [26] |
| Notification restaurant | Tableau de bord web sur tablette avec bouton « Accepter » et e-mail | 0 (offres gratuites Resend et Brevo non vérifiées) |
| SMS client (heure confirmée ou modifiée) | Twilio | 0.0769 USD par SMS vers un mobile suisse [27] |
| Impression | Deux imprimantes Star CloudPRNT ou Epson Server Direct Print. Chacune interroge une URL HTTPS toutes les 5 s environ, sans PC sur place [28]. À l'acceptation, la fonction crée une tâche « pizzas » et une tâche « cuisine » | Star mC-Print3 Ethernet 257 à 267 CHF. Epson TM-m30III dès 207.70 CHF, 319 CHF en Wi-Fi [29]. Ethernet recommandé |
| Alternative impression | PrintNode | 9 USD/mois, mais il faut un PC allumé [30] |

Ce système couvre tout le besoin, y compris les suppléments payants, les retraits gratuits imprimés en clair, la précommande et les zones par NPA. Le risque est ailleurs : la maintenance, la panne un samedi soir et le temps de Jérémy.

## 5. Obligations légales pour vendre sur son propre site

| Sujet | Obligation | Référence |
|---|---|---|
| Identification et tunnel de commande | Raison sociale, adresse et e-mail. Étapes de la commande, correction des erreurs, confirmation immédiate par e-mail | LCD art. 3 al. 1 let. s [34] |
| TVA | 2,6 % sur la nourriture et les boissons sans alcool emportées ou livrées, si la vente est séparée de la consommation sur place. 8,1 % pour l'alcool et sur place. Assujettissement dès 100 000 CHF de chiffre d'affaires | LTVA art. 10 et 25 [35], OTVA art. 55 et 56 [36] |
| Ticket | Mentions de l'art. 26 LTVA. Le nom du client peut être omis jusqu'à 400 CHF | OTVA art. 57 [36] |
| Allergènes et origine | Informations disponibles avant l'achat en vente à distance. Origine de la viande et du poisson indiquée par écrit | ODAlOUs art. 39 et 44, OIDAl art. 5 [37] |
| Données personnelles | Déclaration de confidentialité citant les prestataires et les pays étrangers (Stripe, Netlify). Registre des traitements | nLPD art. 9, 12, 16 et 19 [38] |
| Prix | En CHF, TVA et suppléments obligatoires inclus. Frais de livraison affichables à part | OIP art. 3, 4 et 10 [39] |
| CGV | Pas obligatoires, mais elles ne doivent pas être abusives | LCD art. 8 [34] |
| Alcool | Autorisation de vente à l'emporter distincte de la licence. Vente interdite de 21 h à 7 h. Âge minimum 16 ou 18 ans. Le cas de la livraison est à confirmer auprès du PCTN | LTGVEAT art. 6, 7, 10 et 12, LRDBHD art. 31 [40] |
| Hygiène | Annoncer au SCAV le changement d'activité (livraison) | ODAlOUs art. 20 [37] |

## 6. Coursiers à Genève (secondaire)

- **Uber Direct** : dès 6.50 CHF la livraison, sans commission [2]. Le prix exact se fait sur devis et la desserte d'Onex n'est pas confirmée [32].
- **Coursiers express** : Go-Fast dès 15 CHF en semaine de 8 h à 18 h, Presto GVA dès 15 CHF, Martins Transports 19 CHF la livraison hors abonnement [33]. Aucun ne mentionne de sac isotherme.
- **Dring Dring et Vélocité** : ils ne livrent pas à Genève.

Ces services ne servent que de dépannage pendant un pic.

## Recommandation

**Construire le système maison, avec Pikit Max en plan de repli à tester en parallèle.**

1. **Le coût.** À 20 commandes par jour, Uber Eats prend 3 900 CHF par mois même en livraison propre (15 %). Le système maison avec Payrexx coûte environ 360 CHF, presque uniquement en frais de paiement. L'écart dépasse 3 500 CHF par mois. Il reste comparable à 10 commandes par jour (environ 1 750 CHF d'écart) (calcul sur hypothèses non vérifiées).
2. **Le besoin bloquant.** Il s'agit de l'impression automatique à l'acceptation sur deux imprimantes avec tri pizzas / cuisine. Aucune solution lue ne le documente pour les commandes en ligne sans remplacer la caisse. Lightspeed le fait en caisse mais pas de façon documentée pour Order Anywhere [8]. storekit le fait, mais sa disponibilité en Suisse n'est pas vérifiée [20]. En maison, c'est une trentaine de lignes de code autour de CloudPRNT [28].
3. **La carte.** Le système maison lit carte.json : pas de double saisie des 139 plats. Les suppléments et retraits d'ingrédients se modélisent librement et s'impriment comme on veut.
4. **Le paiement.** Payrexx Standard est moins cher que Stripe d'environ 85 à 290 CHF par mois selon le volume. Son abonnement est à confirmer par écrit avant de choisir.

Garder Uber Eats pendant la transition. Si La Ferme livre déjà elle-même, vérifier qu'elle est bien sur la formule Standard à 15 % et non Léger à 32 % [1].

**Avant de décider :**
- Demander une démo à Pikit avec trois questions : impression sur deux imprimantes avec routage, options d'ingrédients, prestataire et frais de paiement de l'offre Max.
- Demander un devis Lightspeed Pro (frais de paiement, Order Anywhere vers les centres de production).
- Confirmer l'abonnement Payrexx.
- Commander une imprimante Star mC-Print3 et faire un test CloudPRNT depuis Netlify.
- Faire l'annonce au SCAV.
- Pour l'alcool en livraison, demander au PCTN.

## Sources (consultées le 3.11.2026)

1. https://merchants.ubereats.com/ch/fr/pricing/
2. https://merchants.ubereats.com/ch/en/services/uber-direct/
3. https://www.rts.ch/info/suisse/11430850-qui-payezvous-vraiment-quand-vous-commandez-vos-repas-en-ligne.html
4. https://www.20min.ch/fr/story/repas-a-domicile-smood-mettra-la-cle-sous-la-porte-a-la-fin-du-mois-d-avril-103508810 et https://www.blick.ch/fr/suisse/romande/smood-le-livreur-de-repas-genevois-met-la-cle-sous-la-porte-id21706387.html
5. https://www.gloriafood.com/
6. https://www.lightspeedhq.com/ch/caisse/restaurant/pricing/
7. https://k-series-support.lightspeedhq.com/hc/articles/1260803521850
8. https://k-series-support.lightspeedhq.com/hc/articles/1260804606770-About-printing
9. https://pikit.ch et https://pikit.ch/fonctionnalites/livraison
10. https://latele.ch/articles/pikit-la-commande-en-ligne-sans-commission-pour-les-restaurants-suisses
11. https://www.yoordi.com/
12. https://www.sumup.com/fr-ch/onlinestore-raiffeisen/
13. https://support.wix.com/en/article/wix-restaurants-adding-and-setting-up-wix-restaurants-orders-new et https://support.wix.com/en/article/wix-payments-service-fees
14. https://www.wix.com/plans
15. https://www.shopify.com/ch/pricing
16. https://apps.shopify.com/zapiet-eats et https://support.zapiet.com/eats/en/articles/8979855-configure-local-delivery
17. https://www.get-sides.de/en/pricing et https://support.get-sides.de/portal/en/kb/articles/activate-twint-payment-method-in-the-webshop
18. https://www.menutiger.com/pricing
19. https://www.flipdish.com/pricing et https://help.flipdish.com/en/articles/9585385-configure-pre-ordering
20. https://storekit.com/docs/guides/printing/split-printing
21. https://squareup.com/help/us/en/article/5106-square-international-availability et https://www.owner.com/pricing
22. https://stripe.com/en-ch/pricing/local-payment-methods et https://stripe.com/ch/pricing
23. https://www.payrexx.com/de-ch/preise/
24. https://datatrans.weareplanet.com/pricing
25. https://www.netlify.com/pricing/ et https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
26. https://supabase.com/pricing
27. https://www.twilio.com/en-us/sms/pricing/ch
28. https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html
29. https://www.toppreise.ch/browse?q=Star+Micronics+mC-Print3 et https://www.toppreise.ch/browse?q=Epson+TM-m30III
30. https://www.printnode.com/en/pricing
31. https://www.ge.ch/actualite/salaire-minimum-genevois-2026-etablira-2459-fr-heure-1-10-2025
32. https://www.uber.com/fr/fr/b/courier-services/geneve-ge-ch/
33. https://www.go-fast.ch/services.html, https://prestogva.com/ et https://www.martinstransports.ch/entreprises.html
34. https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/fr (LCD)
35. https://www.fedlex.admin.ch/eli/cc/2009/615/fr (LTVA)
36. https://www.fedlex.admin.ch/eli/cc/2009/828/fr (OTVA)
37. https://www.fedlex.admin.ch/eli/cc/2017/158/fr (OIDAl) et https://www.fedlex.admin.ch/eli/cc/2017/63/fr (ODAlOUs)
38. https://www.fedlex.admin.ch/eli/cc/2022/491/fr (nLPD)
39. https://www.fedlex.admin.ch/eli/cc/1978/2081_2081_2081/fr (OIP)
40. https://silgeneve.ch/legis/program/books/rsg/htm/rsg_i2_25.htm (LTGVEAT) et https://silgeneve.ch/legis/program/books/rsg/htm/rsg_i2_22.htm (LRDBHD)
41. https://blog.sparissimofood.com/en/blog/just-eat-vs-uber-eats-switzerland
42. https://www.tageskarte.io/gastronomie/detail/weg-von-30-provision-so-bauen-restaurants-2026-ihren-eigenen-online-bestellkanal-auf.html
43. https://www.zunapro.com/switzerland/fr/site-restaurant-prix

Limites : les chiffres ont été lus par un outil automatique. Il faut les revérifier à l'œil avant de les montrer à Giuseppe. Plusieurs pages officielles ont renvoyé une erreur 403 (TWINT, Just Eat, Le Temps). Les options d'ingrédients et leur impression ne sont vérifiées pour aucune solution du marché.