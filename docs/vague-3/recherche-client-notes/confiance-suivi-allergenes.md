# Confiance du client pendant et après la commande : suivi, délais, retards, annulations, remboursements, allergènes (règles suisses)

Notes de recherche du 13.11.2026. Ce ne sont pas des conseils juridiques : je rapporte ce que disent les textes et les autorités. Les affirmations des fournisseurs (Stripe, éditeurs de logiciels SMS, Domino's) sont marquées « fournisseur ». Les pages d'aide officielles d'Uber Eats, Just Eat CH, Deliveroo et DoorDash n'ont pas pu être lues (404 ou absentes des résultats) : ce qui les concerne vient de sources secondaires et est marqué comme tel.

## ETA : précision, retard contre avance, fourchette contre heure unique, mise à jour

### Takeaway
La preuve la plus solide (expériences et données de transactions) dit que c'est l'écart avec l'heure **annoncée par le prestataire** qui pèse sur la satisfaction et le réachat, plus que les attentes propres du client. Une fourchette (40 à 50 min) donne une meilleure satisfaction qu'une heure unique (45 min), surtout quand la commande est en retard, et ajouter une heure précise à la fourchette n'aide pas.

### Cited Findings
- Hu, Gaertig et Dietvorst, *Management Science* : huit expériences, N = 5 323. Les participants jugent une appli de livraison plus favorablement quand elle affiche une fourchette (exemple 40 à 50 min) plutôt qu'une heure unique (45 min). Explication des auteurs : une fourchette est moins souvent « violée » négativement. Ajouter une heure unique à la fourchette n'améliore pas la satisfaction et réduit même la précision perçue — [Management Science, DOI 10.1287/mnsc.2023.00137](https://pubsonline.informs.org/doi/10.1287/mnsc.2023.00137) ; [SSRN 4927151](https://papers.ssrn.com/sol3/Delivery.cfm/4927151.pdf?abstractid=4927151&mirid=1). Année exacte de parution non vérifiée (article lu via le résumé du moteur de recherche, pas en texte intégral).
- Jing et Qiu, PACIS 2022 (expérience en ligne, théorie de la disconfirmation des attentes) : en cas de **retard**, l'ETA en fourchette réduit significativement la disconfirmation et l'insatisfaction par rapport à l'ETA ponctuel ; quand la livraison est **à l'heure**, le format n'a aucun effet significatif. L'avance n'est pas traitée dans le résumé. Taille d'échantillon non indiquée sur la page — [AIS eLibrary, PACIS 2022 n° 88](https://aisel.aisnet.org/pacis2022/88/)
- Harter, Stich et Spann, *Journal of Service Research* (2025, en ligne 2024) : données de transactions d'un service de livraison rapide (quick commerce) d'Europe de l'Ouest plus une expérience contrôlée. La satisfaction vis-à-vis du délai est le mécanisme clé ; le délai **comparé à l'estimation du prestataire** a un effet important et significatif sur l'intention de réachat, alors que les attentes internes du client ont peu d'effet — [SAGE, DOI 10.1177/10946705241236961](https://journals.sagepub.com/doi/10.1177/10946705241236961) (page en 403, contenu lu via le résumé du moteur de recherche ; quick commerce et non restauration).
- Un article conceptuel de 2025 (IJRISS) soutient qu'une heure confirmée précise augmente satisfaction et réachat mais que la fourchette donne un point de référence plus faible ; il s'agit d'hypothèses, pas d'un test empirique — [RSIS International, IJRISS vol. 9](https://rsisinternational.org/journals/ijriss/view/the-role-of-delivery-time-guarantees-and-accuracy-in-shaping-customer-loyalty-in-online-food-delivery-ofd-services)
- Domino's a commandé une étude qui décrit l'attente d'une pizza comme des « montagnes russes » psychologiques ; le Pizza Tracker est né en partie de ce constat (récit journalistique, étude non publiée) — [NPR Planet Money, transcription](https://www.npr.org/transcripts/nx-s1-5974101)
- Des clients Domino's, Papa John's et Pizza Hut ont signalé des étapes du tracker qui ne correspondent pas à la réalité (presse spécialisée) — [Marketing Dive](https://www.marketingdive.com/news/dominos-app-users-question-veracity-of-pizza-tracker/511855/) ; [QSR Magazine](https://www.qsrmagazine.com/food/pizza/is-your-pizza-tracker-telling-the-truth/)

### Inferences
- Pour La Ferme : l'heure confirmée par la tablette devrait s'afficher en fourchette (par exemple « entre 19 h 40 et 19 h 50 ») plutôt qu'en heure unique, sans ajouter l'heure précise à côté. C'est l'heure annoncée par le restaurant qui sert de référence au client : la promesse doit être réaliste plutôt qu'optimiste.
- Le gain de la fourchette est surtout une protection en cas de retard. À l'heure, le format ne change rien : le vrai levier reste de tenir l'heure.
- Un statut affiché qui ment (« en cuisine » alors que rien n'a commencé) nuit à la confiance : les étapes doivent refléter une action réelle de l'équipe (acceptation, impression, départ).

### Gaps
- Pas de source primaire trouvée sur l'effet d'une **avance** (livraison plus tôt que l'heure annoncée) en restauration. Pour le retrait, une avance n'a pas d'effet documenté dans ces sources.
- Pas de donnée publique trouvée sur la précision des ETA d'Uber Eats, DoorDash ou Deliveroo (blogs d'ingénierie non lus faute de budget de recherche), ni sur l'effet mesuré d'une **mise à jour** de l'ETA en cours de commande.
- Pas de seuil chiffré (« combien de minutes de retard sont tolérées ») trouvé dans une source fiable.

## Suivi en direct et notifications : carte du livreur ou étapes simples, e-mail, SMS, web push, WhatsApp

### Takeaway
Aucune étude rigoureuse ne mesure l'effet d'une carte du livreur pour un petit restaurant ; les preuves disponibles portent sur l'utilité de lever l'incertitude (Domino's) et sur l'exactitude des étapes. Sur les canaux, les chiffres qui circulent (SMS lu à 98 %, e-mail à 20 %) sont des affirmations de fournisseurs non vérifiées.

### Cited Findings
- Domino's annonce plus de 2,5 milliards de commandes suivies par le Pizza Tracker depuis 2008 (communiqué, mars 2026, fournisseur, sans donnée sur la satisfaction) — résumé du moteur de recherche citant [Domino's investor relations](https://dominos.gcs-web.com/node/24451/pdf)
- Aucune étude évaluée par des pairs trouvée sur l'effet du Pizza Tracker sur l'anxiété ou la satisfaction ; les affirmations de satisfaction viennent de blogs et de la presse spécialisée — [The Hustle](https://thehustle.co/originals/how-the-dominos-pizza-tracker-conquered-the-business-world) ; [Medium, 2024](https://medium.com/@The.Nikki.Chronicles/dominos-pizza-tracker-turning-frowns-into-funds-with-ux-aad760b75c1a)
- Taux d'ouverture « SMS environ 98 %, e-mail environ 20 à 21 % » : chiffre repris par des blogs d'éditeurs (attribution à Gartner non vérifiable), **fournisseur** — [Upper, SMS vs Email Delivery Notifications](https://www.upperinc.com/blog/sms-vs-email-delivery-notifications/) ; [Vonage](https://www.vonage.com/resources/articles/sms-marketing-vs-email-marketing/)
- Les taux d'ouverture d'e-mails sont faussés par les protections de vie privée : Brevo cite 20,73 % ou 33,87 % selon qu'on compte ou non les ouvertures Apple MPP (fournisseur) — résumé du moteur de recherche, source [Redo, février 2026](https://redo.com/blogs/email-vs-sms-post-purchase)
- Pitney Bowes (fournisseur) : pour la génération Z, le SMS est le canal préféré pour les avis de suivi (44 % contre 32 % pour l'e-mail) ; date et échantillon non précisés — [Pitney Bowes, BTW LMK RN](https://www.pitneybowes.com/us/blog/tracking.html)
- Pratique recommandée par des éditeurs : e-mail pour le détail, SMS ou push pour les étapes urgentes (« en route », « livraison tentée ») (fournisseur) — [AfterShip](https://www.aftership.com/blog/order-tracking-notification-alternatives)
- Un chiffre « 67 % des consommateurs attendent une confirmation dans les 60 secondes (National Restaurant Association, 2024) » circule dans un guide WooCommerce mais n'a pas pu être retrouvé à la source primaire : à ne pas utiliser — [WPSlash](https://www.wpslash.com/?p=5026)

### Inferences
- Pour une pizzeria qui livre dans une petite zone (Onex et environs) avec ses propres livreurs, des étapes simples et vraies (reçue, acceptée avec heure, en préparation, en route, livrée) répondent au besoin documenté (lever l'incertitude). Une carte GPS ajoute de la complexité sans preuve d'un gain pour ce type d'établissement.
- L'e-mail est lu de façon incertaine pendant l'attente. L'étape qui compte le plus (acceptation avec heure, ou refus) mérite un canal plus immédiat : la page de suivi qui se met à jour seule, éventuellement un SMS pour l'acceptation et le départ. À arbitrer selon le coût, aucun chiffre neutre ne tranche.

### Gaps
- Pas de source neutre (académique ou statistique suisse) sur le canal préféré des clients suisses pour les avis de commande ; rien trouvé sur WhatsApp Business ni sur le web push dans ce contexte.
- Pas de donnée sur la part des clients qui gardent la page de suivi ouverte.

## Retard et refus : annonce, compensation, ce qui fait revenir après un incident (service recovery)

### Takeaway
La littérature sur le rattrapage de service montre qu'une réponse rapide avec des excuses compte plus que la compensation, et que le « paradoxe du rattrapage » (client plus satisfait après un incident bien géré) joue sur la satisfaction mais pas sur le réachat. La compensation sert surtout quand la réponse est imparfaite.

### Cited Findings
- De Matos et al. (2007), méta-analyse du paradoxe du rattrapage : effet positif et significatif sur la satisfaction, non significatif sur l'intention de réachat, le bouche-à-oreille et l'image — [Journal of Service Research, DOI 10.1177/1094670507303012](https://https-sage-cnpereading-com-443.webvpn1.xju.edu.cn/doi/10.1177/1094670507303012) (miroir universitaire ; source ancienne, hors fenêtre 2022 à 2026, mais référence de base)
- Wirtz et Mattila (2004) : la compensation n'augmente pas la satisfaction quand le rattrapage est déjà bien fait (réponse immédiate et excuses) ; elle est utile dans les cas mixtes (réponse tardive avec excuses, ou immédiate sans excuses). Les auteurs concluent que la compensation remplace mal un bon processus — [Emerald, DOI 10.1108/09564230410532484](https://www.emeraldinsight.com/doi/abs/10.1108/09564230410532484)
- Van Vaerenbergh, Hazée et Costers (2019), méta-analyse de 30 échantillons (N = 7 872) : faire participer le client au rattrapage a des effets plutôt faibles et cet effet ne dépend pas du type de compensation (argent ou excuses) — [Marketing Letters, DOI 10.1007/s11002-018-9470-9](https://link.springer.com/doi/10.1007/s11002-018-9470-9)
- Plaintes publiques de consommateurs (Belgique) contre Uber Eats : remboursements refusés après annulation, un cas où le restaurant et la plateforme se renvoient la responsabilité d'un remboursement après une pizza annulée (anecdotes, hors Suisse) — [Test-Achats, plaintes Uber Eats](https://www.test-achats.be/plainte/plaintes-publiques?companyId=500000876)

### Inferences
- Pour La Ferme : annoncer un retard tôt, avec la nouvelle fourchette et des excuses, avant que le client ne s'inquiète, apporte l'essentiel du rattrapage. Un geste (bon, livraison offerte) est utile surtout si l'annonce est arrivée tard.
- Le refus d'une commande déjà payée est l'incident le plus sensible : le message doit dire clairement que le montant est remboursé, par quel moyen et en combien de temps (voir la section remboursements), et ne pas laisser le client chercher qui est responsable (cas des plaintes Test-Achats).

### Gaps
- Pratiques officielles de compensation des plateformes (crédits Uber Eats, Deliveroo, Just Eat en cas de retard) non trouvées dans une page d'aide officielle.
- Pas d'étude 2022 à 2026 spécifique à la livraison de repas sur la compensation après retard.

## Modifier ou annuler après paiement : ce que permettent les plateformes, jusqu'à quand, effet sur le support

### Takeaway
D'après des sources secondaires concordantes, Uber Eats et Just Eat ne permettent l'annulation libre par le client que tant que le restaurant n'a pas accepté la commande ; ensuite, il faut passer par le support et le remboursement n'est pas garanti. Aucune page d'aide officielle n'a pu être lue.

### Cited Findings
- Uber Eats : annulation avec remboursement complet avant acceptation par le restaurant ; après acceptation, des frais ou l'absence de remboursement sont possibles, éventuellement un remboursement partiel avant la prise en charge par le coursier (guides tiers, non officiels) — [Business Insider India](https://www.businessinsider.in/tech/how-to/how-to-cancel-an-uber-eats-order-and-determine-if-youll-get-a-refund/articleshow/77556262.cms) ; [Android Authority](https://www.androidauthority.com/how-to-cancel-uber-eats-order-3264726/)
- Toast (éditeur de caisse, fournisseur) : quand un client annule une commande Uber Eats, il peut ne pas être remboursé et le restaurant peut quand même être payé ; c'est Uber Eats qui traite l'annulation et le remboursement — [Toast, aide](https://support.toasttab.com/fr-CA/article/Manage-Orders-Canceled-by-Third-Party-Partners)
- Just Eat : annulation dans l'appli possible seulement dans une fenêtre très courte, tant que le restaurant n'a pas confirmé ; ensuite par le service client. Droit au remboursement si la commande est erronée, n'arrive pas ou est annulée par le restaurant (site revendeur de cartes cadeaux, non officiel) — [Recharge, Just Eat stornieren](https://www.recharge.com/de/de/just-eat/infos/just-eat-bestellung-stornieren) ; [Recharge, Rückerstattung](https://www.recharge.com/de/de/just-eat/infos/just-eat-r-ckerstattung-bekommen)
- Just Eat UK, côté restaurant : un guide explique aux partenaires comment gérer les demandes de remboursement et de compensation — [Just Eat Partner Centre UK](https://partner.just-eat.co.uk/knowledge-centre/compensation) (non lu en détail)

### Inferences
- La règle de marché la plus répandue (annulation libre avant acceptation, sur demande ensuite) correspond au modèle de La Ferme : un bouton « annuler » sur la page de suivi tant que la commande est « reçue » et pas encore acceptée, puis le téléphone du restaurant.
- Cette règle limite la charge au support : le seul moment où l'annulation est automatique est celui où rien n'a été préparé.

### Gaps
- Pages officielles Uber Eats CH, Just Eat CH (just-eat.ch/help), Domino's CH sur l'annulation et la modification : non lues (404 ou absentes). À vérifier avant toute citation dans un document public.
- Aucune donnée chiffrée trouvée sur l'effet d'un bouton d'annulation sur le volume d'appels au support.
- Modification d'une commande déjà payée (ajout d'un plat, changement d'adresse) : rien trouvé sur les règles des plateformes.

## Délai de remboursement TWINT et carte via Stripe : ce que voit le client et quoi lui dire

### Takeaway
Selon la documentation Stripe, un remboursement TWINT aboutit en général en quelques minutes et revient sur le solde TWINT ou le moyen lié ; un remboursement par carte prend 5 à 10 jours ouvrables pour apparaître (Stripe cite aussi 5 à 14 jours ouvrables ailleurs), sauf annulation rapide qui fait disparaître le débit.

### Cited Findings
- TWINT via Stripe : remboursement possible jusqu'à 180 jours après le paiement ; « Refunds usually take a few minutes to complete » ; remboursements complets, partiels et multiples ; total plafonné au paiement initial ; un remboursement TWINT ne peut pas être annulé ; jamais traité comme une annulation (reversal), les fonds reviennent au solde TWINT ou au moyen de paiement lié ; si le remboursement échoue, le montant revient sur le solde Stripe et il faut rembourser autrement (doc Stripe, fournisseur) — [Stripe Docs, TWINT payments](https://docs.stripe.com/payments/twint) (lu le 13.11.2026)
- TWINT via Stripe : capture manuelle, capture partielle et autorisation prolongée **non prises en charge** ; montant minimal 0,50 CHF, maximal 5 000 CHF ; statut final notifié par `refund.updated` ou `refund.failed` — [Stripe Docs, TWINT payments](https://docs.stripe.com/payments/twint)
- Exigences TWINT côté site (Stripe) : raison sociale, forme juridique, adresse complète, CGV, prix en CHF, au moins un e-mail ou un téléphone de contact visible — [Stripe Docs, TWINT payments](https://docs.stripe.com/payments/twint)
- Carte via Stripe : un remboursement peut prendre 5 à 10 jours ouvrables pour apparaître ; s'il est émis peu après le paiement, il peut prendre la forme d'une annulation et le débit initial disparaît du relevé sans ligne de remboursement ; après 10 jours ouvrables, le client doit contacter sa banque avec l'ARN fourni par le commerçant — [Stripe Support, Where is my customer's refund?](https://support.stripe.com/questions/how-long-do-refunds-take-to-reach-my-customer) ; [Stripe Support, No refund credit after ten business days](https://support.stripe.com/questions/no-refund-credit-after-ten-business-days)
- Stripe donne ailleurs une fourchette plus large de 5 à 14 jours ouvrables selon le réseau et la banque (guide commercial, fournisseur) — [Stripe, Refunds for businesses](https://stripe.com/en-be/resources/more/refunds-for-businesses)
- Un remboursement peut rester « en attente » si le solde Stripe du commerçant est insuffisant — [Stripe Support](https://support.stripe.com/questions/how-long-refunds-take-to-process)

### Inferences
- Texte à donner au client lors d'un refus, selon le moyen : TWINT, « remboursé sur votre TWINT, en général en quelques minutes » ; carte, Apple Pay ou Google Pay, « remboursé sur votre carte, visible sous 5 à 10 jours ouvrables selon votre banque ; si le paiement vient d'être fait, il peut simplement disparaître de votre relevé ». À faire relire par `redaction-fr`.
- Garder l'ARN accessible côté gestion pour répondre à un client qui ne voit rien après 10 jours ouvrables.
- Le solde Stripe doit couvrir les remboursements du jour (cas « en attente »).

### Gaps
- Page officielle TWINT (twint.ch) sur les délais vus par l'utilisateur non consultée ; seule la doc Stripe est citée.
- Délais spécifiques Apple Pay et Google Pay : non trouvés séparément (ils suivent en principe la carte sous-jacente, non vérifié).

## Allergènes : droit suisse pour la vente à distance de denrées non préemballées, oral ou écrit, bonnes pratiques

### Takeaway
L'offre à distance (art. 44 ODAlOUs, RS 817.02) renvoie aux informations de l'art. 39 ODAlOUs pour le vrac, dont les allergènes de l'annexe 6 OIDAl (RS 817.022.16, 14 groupes). Ces informations doivent être disponibles au moment où la denrée est proposée ; l'écrit peut être remplacé par une autre forme qui garantit l'information, « p. ex. page internet » (Office vaudois de la consommation, 2020). L'OSAV admet l'information orale à condition qu'un avis écrit l'annonce et que le personnel ait des notes écrites ou une personne informée. Aucune source lue ne dit expressément si un renvoi au téléphone suffit pour une vente en ligne.

### Cited Findings
- Office de la consommation du canton de Vaud (18.3.2020), « Résumé non exhaustif des bases légales et directives concernant la vente à l'emporter ainsi que la livraison de denrées alimentaires en vrac » : pour les offres au moyen d'une technique de communication à distance (art. 44 ODAlOUs), si des denrées non préemballées sont proposées, les informations de l'art. 39 ODAlOUs doivent être communiquées ; on peut se passer d'une déclaration écrite si l'information est garantie d'une autre manière (« p. ex. page internet, flyer, etc. ») ; « Ces informations [...] doivent être disponibles au moment où la marchandise est proposée au consommateur » ; elles comprennent les ingrédients pouvant provoquer des allergies (annexe 6 OIDAl), la provenance de la viande et du poisson et les mentions de l'ordonnance sur la déclaration — [VD, Vente à l'emporter et livraisons à domicile](https://www.vd.ch/fileadmin/user_upload/themes/economie_emploi/protection_consommateur/fichiers_pdf/Vente_%C3%A0_l_emporter_et_livraisons_%C3%A0_domicile_-_r%C3%A9sum%C3%A9_des_bases_l%C3%A9gales_e....pdf). Attention : le document cite l'OIDAl sous le numéro « RS 817.02.16 », le bon numéro est RS 817.022.16. Document antérieur à des révisions éventuelles, à confronter au texte en vigueur.
- Même document vaudois : transport des plats chauds au-dessus de 65 °C, des denrées périssables en dessous de 5 °C, températures contrôlées et documentées au départ et à l'arrivée chez le client (par sondage), durée de transport la plus courte possible (Guide BPHR, ch. 2.5.3) — [VD, même document](https://www.vd.ch/fileadmin/user_upload/themes/economie_emploi/protection_consommateur/fichiers_pdf/Vente_%C3%A0_l_emporter_et_livraisons_%C3%A0_domicile_-_r%C3%A9sum%C3%A9_des_bases_l%C3%A9gales_e....pdf)
- Annexe 6 OIDAl (reproduite dans le document vaudois) : céréales contenant du gluten, crustacés, œufs, poissons, arachides, soja, etc., qui « doivent donc toujours être indiqués » — [VD, annexe](https://www.vd.ch/fileadmin/user_upload/themes/economie_emploi/protection_consommateur/fichiers_pdf/Vente_%C3%A0_l_emporter_et_livraisons_%C3%A0_domicile_-_r%C3%A9sum%C3%A9_des_bases_l%C3%A9gales_e....pdf)
- OSAV, « Informations sur les aliments vendus en vrac » (page sans date) : restaurants et take-aways visés ; « En principe, les allergènes doivent être déclarés par écrit, sauf s'il est annoncé par écrit que les informations sont fournies oralement » ; dans ce cas le personnel doit disposer de notes écrites ou l'information doit pouvoir être fournie par une personne informée ; la page range aussi « la mention concernant l'information sur les allergènes » parmi ce qui doit toujours être écrit (c'est l'avis écrit qui est obligatoire) ; pour la vente en ligne de pain, l'information doit être visible « avant la décision d'achat » ; la page cite l'art. 39 et l'art. 44 ODAlOUs — [OSAV / BLV, Offenverkauf](https://blv.admin.ch/blv/fr/home/lebensmittel-und-ernaehrung/lebensmittelsicherheit/naehrwertinformationen-und-kennzeichnung/offenverkauf.html)
- Canton de Fribourg (23.4.2025) : contrôles ciblés des chimistes cantonaux en 2024 dans plus de 900 établissements ; information correcte dans 74 %, lacunes dans 26 %, aucune information dans 13 % ; en 2018, lacunes dans 55 % et aucune information dans 18 % ; l'information orale est admise « sous certaines conditions », le client devant être informé par écrit qu'il peut demander au personnel — [État de Fribourg, Allergènes : les consommateurs sont-ils correctement informés ?](https://www.fr.ch/sante/securite-sanitaire/actualites/allergenes-les-consommateurs-sont-ils-correctement-informes)
- Le texte consolidé de l'ODAlOUs sur Fedlex n'a pas pu être lu (page en JavaScript) — [Fedlex, RS 817.02](https://www.fedlex.admin.ch/eli/cc/2017/63/fr)
- aha! Centre d'Allergie Suisse conseille aux personnes allergiques d'écrire leurs allergènes sur une carte et de la remettre au personnel du restaurant en commandant — [aha!, Food allergy](https://www.aha.ch/swiss-allergy-centre/allergies-intolerances/food-allergies/food-allergy?lang=en)
- aha! a consacré son thème 2024 aux allergies « en route », avec une fiche qui conseille de vérifier comment les allergènes et les traces sont déclarés et de commander un menu spécial à l'avance — [aha!, focus check 2024](https://www.aha.ch/centre-allergie-suisse/allergies-intolerances/bon-a-savoir/theme-de-l-annee/les-allergies-en-route/themes-2024/focus-check) (lu via le résumé du moteur de recherche)
- Pour comparaison, droit de l'UE (ne s'applique pas en Suisse) : pour les denrées non préemballées vendues à distance, seule l'information allergènes de l'art. 44 du règlement 1169/2011 est exigée — [Commission européenne, Distance selling](https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/distance-selling_en)

### Inferences
- La mention actuelle « Allergènes : demandez-nous au 022 792 16 89 » ressemble au mécanisme oral admis par l'OSAV (avis écrit plus information orale). Mais pour une offre à distance, le texte vaudois insiste sur une information disponible au moment de l'offre et cite la page internet comme alternative à l'écrit : un renvoi au téléphone pendant que la commande se passe en ligne est fragile. Cela confirme la décision du projet de bloquer la mise en ligne tant que les allergènes ne sont pas fournis. À faire confirmer par le Service de la consommation et des affaires vétérinaires (SCAV) de Genève, autorité compétente pour Onex.
- Le taux de lacunes encore observé en 2024 (26 % des établissements) indique que les contrôles cantonaux visent ce point : une fiche allergènes par plat affichée avant l'ajout au panier est la forme la plus sûre.
- Bonnes pratiques à proposer (à valider avec le restaurant, jamais à inventer) : liste des 14 allergènes de l'annexe 6 par plat, affichée sur la fiche du plat avant l'achat, reprise sur le ticket ou l'e-mail de confirmation ; champ « allergie à signaler » imprimé en clair sur le ticket cuisine ; « peut contenir des traces » seulement si le restaurant l'établit.

### Gaps
- Texte exact des art. 39 et 44 ODAlOUs dans leur version en vigueur au 13.11.2026 non lu (Fedlex inaccessible à l'outil). Le rapport doit citer l'OSAV et le canton de Vaud, pas une formulation d'article reconstruite.
- Aucune source lue ne tranche si l'information orale par téléphone suffit pour une commande en ligne. Question à poser au SCAV Genève.
- Règle suisse sur la mention « peut contenir » (contaminations croisées) non trouvée dans les sources lues.
- Le guide pratique de la BFH sur l'étiquetage des allergènes (2020) et une enquête suisse transversale sur l'information allergènes des denrées non préemballées sont apparus dans les résultats mais n'ont pas pu être lus (403) : [BFH, Praxisleitfaden Allergenkennzeichnung](https://www.bfh.ch/dam/jcr:3bf565ef-67b3-42de-aede-b7e29a7027b5/2020_aF%26E_Praxisleitfaden_Allergenkennzeichnung_v7_web.pdf) ; [enquête suisse, notice OUCI](https://ouci.dntb.gov.ua/works/4N2veqj4).
- Aucune donnée trouvée sur les attentes chiffrées des clients allergiques pour la commande en ligne (filtres, pictogrammes).
