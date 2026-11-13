# Recherche gestion : ce que les outils professionnels donnent au gérant et que La Ferme n'a pas

Date de consultation de toutes les sources : 13 novembre 2026. Budget : 35 appels web, tous utilisés.

Règle de lecture. Un numéro entre crochets [n] renvoie à une page lue directement. Un renvoi [Rn] renvoie à un résultat de recherche dont la page n'a pas été ouverte : l'affirmation est alors marquée « non vérifié ». La colonne « La Ferme » se fonde sur la description fournie dans la demande, pas sur le code. Chaque « non » est à vérifier dans le dépôt avant d'en faire une ligne du carnet. La ligne 4 du résumé a été corrigée après relecture de `docs/mode-emploi.md`.

## 1. Résumé en 12 lignes

Les douze fonctions ci-dessous reviennent dans plusieurs outils lus. La Ferme ne les a pas ou ne les a qu'en partie. Elles sont classées par utilité un vendredi soir (1 à 7) puis un lundi matin (8 à 12).

| # | Fonction | Vue chez | La Ferme |
|---|---|---|---|
| 1 | Écran de cuisine avec minuteur par ticket qui passe au jaune puis au rouge | Fresh KDS [2], Square KDS [3] | non |
| 2 | Mode « très occupé » à durée choisie, qui allonge le délai annoncé puis se coupe seul | Square [9], Pikit [1], Uber Eats [5] | en partie (retard du soir, pause) |
| 3 | Rupture à durée (une heure, ce soir, jusqu'à une date) avec remise en vente automatique | Deliverect [13], Uber Eats [5], GloriaFood [8] | en partie (rupture sans échéance) |
| 4 | Arrêt automatique des commandes quand la tablette ne répond plus, avec alerte au gérant | Toast [17], Otter [19] | oui pour l'arrêt (pause automatique après 3 minutes, `docs/mode-emploi.md`), en partie pour l'alerte (e-mail, pas de notification sur le téléphone) |
| 5 | Lien de suivi en direct du livreur pour le client, avec SMS aux étapes | Onfleet [6], Shipday [7], Tookan [11] | non |
| 6 | Rappel d'un ticket clos et compteur « all day » des articles en cours | Fresh KDS [2], Square KDS [3] | non |
| 7 | Commande prise au téléphone saisie dans le même tableau, mêmes créneaux, même ticket | Pikit [1], Toast [17] | non (non décrit) |
| 8 | Rapport de temps de préparation par heure et par poste | Toast [16] | non |
| 9 | Performance des livreurs (taux de livraisons à l'heure, temps par livraison) et preuve de livraison horodatée | Onfleet [6], Shipday [7] | non |
| 10 | Codes promo bornés, formules, fidélité, relance automatique des clients inactifs | Pikit [1], GloriaFood [14] | non (non décrit) |
| 11 | Droits fins par action et code de responsable pour débloquer une action sensible | Toast [4], Square [9] [15], Deliverect [13] | en partie (trois accès) |
| 12 | Avis du client après la livraison, rattaché à la commande et au livreur | Onfleet [6], Shipday [7], Tookan [11] | non |

Constat général. Sur la prise de commande, la carte, les zones, la capacité par créneau, les remboursements et le journal avec annulation, La Ferme est au niveau de Pikit et au-dessus de GloriaFood tel que lu. Le « maigre » vient de trois trous : pas de mesure du temps (cuisine et livraison), pas de vue client du livreur, pas de filet automatique quand quelque chose casse.

## 2. Tableaux par domaine

### 2.1 Tableau de bord du jour et pilotage en direct

| Fonction | Qui la propose et comment | La Ferme | Intérêt à 300 commandes par jour |
|---|---|---|---|
| Alertes poussées au gérant | Otter Live Alerts prévient par notification mobile et SMS quand le magasin est hors ligne alors qu'il devrait être ouvert, quand une commande est annulée ou quand des plats manquent au menu. Réglage par type d'alerte [19]. | non | Fort. Le propriétaire n'est pas toujours au comptoir. Deux alertes suffisent : tablette muette, commande annulée. |
| Suivi des pauses dans le temps | Otter affiche l'historique des pauses du magasin et propose « Always On » qui rouvre un magasin mis en pause par l'équipe [19]. | non | Moyen. Utile pour savoir combien de minutes de vente ont été perdues un vendredi. |
| Retards probables signalés avant qu'ils arrivent | Onfleet recalcule les heures d'arrivée dans la journée et signale les livraisons qui risquent d'être en retard [6]. | non | Fort. À 60 commandes à l'heure, le comptoir ne peut pas surveiller chaque tournée. |
| Pause restante visible | Square affiche une bannière avec l'état de pause et le temps restant dans le gestionnaire de commandes [15] [9]. | en partie (pause existe, affichage non décrit) | Faible à moyen. Évite l'oubli de la pause. |
| Temps moyen de préparation affiché en cuisine | Toast KDS affiche un minuteur de temps moyen de préparation sur les écrans de poste et de passe. Non vérifié [R1]. | non | Fort. C'est le chiffre « réel contre promis » demandé. |
| Ventes et tickets par heure | Toast « Tickets by Hour » montre par heure les ventes nettes, le nombre de tickets servis et le temps moyen [16]. Otter annonce ventes, tendances et performance en temps réel, sans détail sur la page lue [12]. | non (export CSV seulement) | Fort le lundi. Moyen le soir même. |

Lecture. Aucune page lue ne décrit un tableau unique « commandes en cours, retards, temps réel contre promis » pour un restaurant indépendant. Les briques existent séparément : minuteurs en cuisine, heures d'arrivée côté livreurs, alertes côté gérant.

### 2.2 Gestion des commandes

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Correction d'une commande acceptée | Pikit corrige une commande et la recalcule depuis la carte [1]. Uber Eats Orders a un bouton « Adjust Order » : marquer une rupture, changer le prix ou l'heure, appeler le client, retarder, annuler [5]. | en partie (« il manque un article » avec remboursement partiel) | Fort. Le cas fréquent est l'échange d'un plat, pas seulement le retrait. |
| Retarder une seule commande | Square permet de repousser une commande par pas de 15 minutes ou à une heure libre. Le client ou le coursier est prévenu [9]. | en partie (heure ajustable à l'acceptation) | Fort. Un four en retard touche trois commandes, pas toute la soirée. |
| Délai laissé au client après une rupture | Uber Eats prévient le client et lui laisse 10 minutes pour confirmer ou modifier sa commande [5]. | non | Moyen. Demande un échange avec le client, donc un SMS ou un lien. |
| Remboursement avec notification | Pikit enregistre le remboursement et envoie un e-mail au client [1]. | oui (total ou partiel) ; notification non décrite | Vérifier que le client reçoit bien un message. |
| Message de l'équipe au client | Pikit envoie un e-mail à chaque étape : reçu, changement de statut, nouveau créneau, remboursement, message de l'équipe [1]. | non décrit | Fort. Évite le coup de téléphone à chaque retard. |
| Commande au téléphone | Pikit : saisie par l'équipe dans le même tableau, mêmes créneaux, même ticket [1]. Toast recommande de saisir au POS les commandes dictées par téléphone pendant une panne [17]. | non décrit | Fort. Une pizzeria de quartier garde des clients au téléphone. Sans saisie, la capacité par créneau est fausse. |
| Passage en attente sans réponse | Toast envoie un e-mail au client si la commande n'est pas approuvée en cinq minutes [17]. | non décrit | Fort. Une commande ni acceptée ni refusée est le pire cas pour le client. |
| Historique et export filtré | Pikit exporte le carnet de commandes filtré en CSV pour la fiduciaire [1]. Uber Eats montre les commandes terminées [5]. | oui (7 jours, recherche, CSV par TVA) | La limite de 7 jours est courte pour une réclamation tardive. À confirmer avec le propriétaire. |
| Litiges et gestes commerciaux | Otter a un produit « Dispute Management » pour les litiges avec les plateformes [12]. | sans objet | Voir section 3. |

Avoirs. Aucune page lue ne décrit un avoir (crédit sur une prochaine commande) distinct du remboursement. Pikit propose des bons cadeaux valables 5 ans en offre Max [1], ce qui peut servir de geste commercial. Non vérifié comme usage prévu.

### 2.3 Fiche client

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Commande sans compte avec historique | Pikit : pas de compte, historique et « recommander » depuis un lien reçu par e-mail. Adresse e-mail vérifiée par code à six chiffres [1]. | non décrit | Moyen. La vérification par code réduit les fausses commandes. |
| Segments par comportement | GloriaFood cible les clients par nombre de commandes passées, montant total ou date de dernière commande [14]. | non | Moyen. À 300 commandes par jour, la base grossit vite. |
| Relance automatique | GloriaFood « Autopilot » envoie des e-mails réglés une fois : deuxième commande, clients inactifs, panier abandonné [14]. | non | Moyen. Utile pour remplacer la visibilité perdue en quittant Uber Eats. |
| Fidélité | Pikit : points par franc dépensé, offre Max [1]. | non | Moyen. Argument direct contre le retour sur Uber Eats. |
| Avis après livraison | Onfleet met un questionnaire sur la page de suivi [6]. Shipday collecte l'avis après la livraison et analyse les retours [7]. Tookan suit notes et commentaires [11]. | non | Fort. C'est le seul signal de qualité une fois les avis Uber Eats perdus. |

Notes internes et clients à bloquer. Aucune page lue ne décrit une note interne sur un client ni une liste de blocage. La page d'accueil de Pikit ne mentionne pas de base clients [1]. Le sujet reste ouvert : voir Limites.

### 2.4 Carte

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Rupture à durée | Deliverect : une heure, plusieurs heures, sans fin ou jusqu'à une date choisie [13]. Uber Eats : pour la journée ou sans fin [5]. GloriaFood : « aussi longtemps que vous voulez », plats et suppléments [8]. | en partie (ruptures de plats et de suppléments, sans échéance décrite) | Fort. Le plat oublié en rupture le lendemain est une vente perdue invisible. |
| Rupture en lot | Deliverect : bouton pour choisir plusieurs produits, recherche par nom, une durée pour tous [13]. | non décrit | Moyen. Cas réel : plus de pâte, toutes les pizzas d'un coup. |
| Liste des ruptures en cours | Deliverect : vue « Snoozed products » avec remise en vente immédiate ou programmée [13]. | non décrit | Fort et peu coûteux. À afficher à l'ouverture. |
| Rupture distincte plat et supplément | Deliverect prévient qu'un article présent comme plat et comme supplément doit être mis en rupture deux fois [13]. | oui (deux types de rupture) | Piège à éviter : lier les deux quand c'est le même ingrédient. |
| Disponibilité par horaire | Pikit : fenêtres de service par plat, midi seulement ou week-end seulement [1]. | en partie (plat du jour, horaires) | Moyen. Utile pour un menu du midi. |
| Formules | Pikit : formules à prix fixe composées étape par étape, menu du midi, menu enfant [1]. | non décrit | Moyen à fort selon la carte. |
| Codes promo | Pikit : pourcentage ou montant fixe, avec minimum, plafond, dates et limites d'utilisation [1]. GloriaFood : promotions limitées à des jours et heures, première commande, récompense selon les achats passés [14]. | non | Fort au lancement. Il faut un levier pour faire migrer les clients d'Uber Eats. |
| TVA par plat figée sur la commande | Pikit : 8,1 % ou 2,6 %, extraite du prix TTC et figée sur chaque commande [1]. | oui (export par taux) ; figée non décrit | À vérifier : un changement de taux ne doit pas modifier les commandes passées. |

### 2.5 Capacité et rush

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Mode occupé à durée | Square « Busy Mode » ajoute du temps de préparation (15 minutes, 30 minutes ou 1 heure). On choisit la durée du mode. On peut le prolonger ou en sortir [9]. Uber Eats « Add ready time » [5]. | en partie (« retard du soir ») | Fort. La différence utile est la fin automatique. |
| Mode coup de feu qui réduit aussi la capacité | Pikit : délai allongé et moins de commandes par créneau, en un geste [1]. | en partie (les deux réglages existent séparément) | Fort. Un seul bouton au lieu de deux écrans à 19 h 30. |
| Pause avec reprise automatique | Pikit : pause immédiate avec reprise à l'heure choisie [1]. Square : jusqu'à demain, jusqu'à une heure précise ou pour un nombre d'heures. Retrait et livraison séparés [9] [15]. Toast : 20 minutes, 40 minutes ou reste du jour [4]. GloriaFood : pause d'un service ou de tous, avec durée et message personnalisé [8]. | en partie (pause ; reprise automatique non décrite) | Fort. Tous les outils lus bornent la pause dans le temps. |
| Pause par canal | Square et GloriaFood séparent retrait et livraison [9] [8]. Toast peut couper la livraison seule [4]. | non décrit | Fort. Quand il manque un livreur, on coupe la livraison et on garde l'emporter. |
| Délai ajouté sans le dire | Toast : le client ne voit que l'heure annoncée, rien n'indique que le restaurant est débordé [4]. | non décrit | Choix de produit. À trancher avec le propriétaire. |
| Plafonds par créneau | Pikit : plafonds de tickets et d'unités cuisine par créneau [1]. | oui (capacité par créneau) | L'unité cuisine est plus juste que le ticket : une commande de huit pizzas ne pèse pas comme une salade. |
| Créneaux décalés par zone | Pikit : créneaux de livraison décalés automatiquement selon le temps de trajet de la zone [1]. | non décrit | Fort avec des livreurs salariés. Le NPA le plus loin ne doit pas promettre la même heure. |
| Pause automatique | Toast coupe la disponibilité quand l'appareil de réception perd la connexion environ cinq minutes [17]. Uber Eats met en pause après plusieurs commandes non acceptées. Non vérifié [R6]. | non | Fort. Voir 2.10. |

Throttling automatique au sens strict. L'article Toast lu décrit des délais et des pauses manuels, pas un étalement automatique selon le volume [4]. Un tiers évoque des stratégies automatiques chez Toast (capacité cuisine, prix de commande). Non vérifié [R1]. Chez Square, un étalement automatique des retraits est décrit sur le forum communautaire, pas dans l'aide. Non vérifié [R8]. La capacité par créneau de La Ferme couvre déjà ce besoin.

### 2.6 Cuisine

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Minuteur et couleurs de retard | Fresh KDS : les tickets passent du vert au jaune puis au rouge à l'approche du retard [2]. Square KDS : « Yellow timer » et « Red timer » réglés en minutes [3]. | non (tickets papier) | Fort. Le papier ne dit pas depuis quand il attend. |
| Poste et passe | Square KDS : écran de préparation qui ne voit que ses articles, écran de passe (« Expo ») avec vue d'ensemble. « Terminer sur cet appareil » ou « sur tous » [3]. | en partie (deux imprimantes routées pizza et cuisine) | Fort. Le passe sait quand la pizza et l'entrée sont toutes deux prêtes. |
| Tout prêt en même temps | Square KDS : option « Staggered item prep times » fondée sur un temps de préparation par article [3]. | non | Moyen à fort. Évite la pizza qui refroidit en attendant un plat chaud. |
| Rappel d'un ticket | Fresh KDS rappelle un ticket déjà effacé [2]. Square KDS permet de rappeler tickets ou articles [3]. | non (réimpression non décrite) | Fort. Un ticket papier perdu ne se retrouve pas. |
| Compteur « all day » | Fresh KDS : total en direct par article pour toutes les commandes ouvertes [2]. Square KDS : panneau « All Day » [3]. | non | Fort pour le poste pizza : « 14 margheritas en cours ». |
| Articles barrés un à un | Fresh KDS : on barre plats et options au fil du travail [2]. | non | Moyen. Réduit les oublis d'articles, cause de remboursements partiels. |
| Tri par heure de retrait | Fresh KDS trie les commandes par temps de préparation et heure de retrait [2]. | non décrit | Fort. Le papier sort dans l'ordre d'arrivée, pas dans l'ordre de départ. |
| Couleur par option | Square KDS : couleur réglable par option de modificateur, visible en poste et au passe [3]. | non | Moyen. Utile pour les allergies et « sans ». |
| Son à l'arrivée | Square KDS : son réglable à l'arrivée d'un ticket [3]. | non décrit | Faible si l'imprimante fait déjà du bruit. |
| Impression en complément | Fresh KDS fonctionne avec une imprimante pour étiquettes et tickets [2]. GloriaFood imprime chaque commande acceptée sur imprimante thermique [8]. Pikit : ticket 80 mm [1]. | oui | L'écran ne remplace pas l'étiquette collée sur le carton. |

Point clé. Les rapports de cuisine de Toast n'existent qu'avec le KDS. Une cuisine à tickets imprimés ne produit aucune donnée [16]. C'est le vrai argument pour un écran : sans geste « prêt » par poste, pas de temps de préparation réel.

### 2.7 Livreurs

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Attribution automatique | Onfleet attribue les commandes à la meilleure tournée disponible en temps réel [6]. Shipday attribue chaque commande au bon livreur [7]. Tookan attribue au livreur disponible le plus proche [11]. | non (attribution manuelle au comptoir) | Faible à moyen. Avec quelques livreurs salariés qui partent tous du même four, le comptoir décide mieux. À revoir au-delà de six livreurs. |
| Regroupement et ordre de tournée | Shipday annonce « Smart batching » et un planificateur d'itinéraires [7]. Onfleet construit des tournées optimisées [6]. | en partie (ordre de tournée manuel) | Moyen. Une suggestion d'ordre par NPA suffirait. |
| Suivi GPS | Onfleet et Tookan suivent chaque livreur en temps réel [6] [11]. | non | Moyen pour le comptoir. Fort s'il alimente le lien client. |
| Lien de suivi pour le client | Onfleet : page de suivi avec position GPS en direct [6]. Shipday : pages de suivi à la marque avec mises à jour en direct [7]. Tookan : lien de suivi et position sur carte [11]. | non | Fort. C'est ce que le client d'Uber Eats a aujourd'hui. Son absence se verra dès le premier soir. |
| SMS aux étapes | Onfleet : SMS personnalisables à chaque étape, à la marque [6]. Shipday : notifications par texte [7]. | non décrit | Fort. « Votre livreur est parti » coupe la moitié des appels. |
| Preuve de livraison | Onfleet : photo et signature à chaque livraison [6]. Shipday : photos, signatures, horodatage précis [7]. | en partie (« livrée » sans preuve) | Fort pour les litiges « jamais reçu ». Une photo devant la porte suffit. |
| Livreurs présents seulement | Toast : seuls les employés pointés avec un poste de livreur peuvent recevoir une course [10]. | non décrit | Moyen. Évite d'attribuer à un livreur parti. |
| Onglets non attribuées, en route, livrées | Toast : trois onglets, tri par heure annoncée, nom du livreur sur la commande [10]. Pikit : livreur nommé sur chaque départ, bouton « Affecter » [1]. | oui | Parité. |
| Changement de livreur après coup | Toast : « Update Driver » transfère la commande et le pourboire au nouveau livreur [10]. | non décrit | Moyen. Corrige une erreur d'attribution sans fausser les pourboires. |
| Clôture du livreur | Toast : toutes les commandes doivent être marquées livrées avant de fermer le service du livreur [10]. | non décrit | Fort si paiement à la remise. Le livreur rend une caisse. |
| Pourboires rattachés au livreur | Toast : le livreur attribué reçoit le pourboire de la commande [10]. Pikit : pourboires avec montants suggérés, ajoutés après TVA, offre Max [1]. | non décrit | Fort pour des salariés. Le décompte doit être incontestable. |
| Relais vers un prestataire | Shipday donne accès à des services de livraison tiers [7]. Uber Eats permet de passer une commande à ses coursiers quand l'équipe ne peut pas livrer [5]. | non | Voir section 3. |

Planning des livreurs. Aucune des trois pages de dispatch lues ne décrit un planning d'équipe. Onfleet ne le mentionne pas [6]. Tookan liste « Capacity Management » sans le décrire [11].

### 2.8 Rapports

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Tickets par heure | Toast : ventes nettes, tickets servis et temps moyen par heure [16]. | non | Fort. Base du réglage de la capacité par créneau. |
| Tickets par temps de préparation et par poste | Toast « Tickets by Fulfillment » : nombre de tickets par poste et par tranche de temps [16]. | non | Fort. Dit si le retard vient du four ou de la cuisine. |
| Détail d'un ticket | Toast « Ticket Details » : ce qui s'est passé sur chaque ticket et quand, export CSV [16]. | en partie (journal des modifications) | Moyen. Sert à répondre à une réclamation. |
| Performance des livreurs | Onfleet : taux de livraisons à l'heure, coût par livraison, temps de service, par livreur [6]. Shipday : rapports sur ventes, livraisons et livreurs [7]. Tookan : historique de suivi sur 90 jours [11]. | non | Fort. Avec des salariés, c'est aussi un outil de gestion d'équipe. À manier avec le droit du travail suisse. Non vérifié ici. |
| Efficacité des promotions | GloriaFood : rapport en temps réel des promotions les plus performantes [14]. | non | Moyen, seulement si les codes promo existent. |
| Clôture de jour | Lightspeed K-Series distingue un rapport de période et un rapport fiscal créé à la clôture du jour. Non vérifié [R4]. | en partie (export CSV par taux de TVA) | Fort. Un PDF de clôture signé par jour fait « vraie entreprise » auprès de la fiduciaire. |
| Export comptable | Pikit : CSV filtré pour la fiduciaire [1]. | oui | Parité. |

Ventes par plat, par zone, annulations et remboursements. Aucune page lue ne détaille ces rapports. Ils sont très probablement standards mais rien ici ne permet de dire qui fait quoi. Non vérifié.

### 2.9 Rôles et droits

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Permissions par action | Toast exige des permissions numérotées pour mettre les commandes en pause, dont « 3.29 Throttle Online Orders » [4]. Deliverect sépare trois permissions : mettre en rupture, remettre en vente, voir les produits [13]. Square réserve pause et temps de préparation aux membres ayant la permission « orders » [9]. | en partie (trois accès) | Moyen. Trois accès suffisent si les actions sensibles sont bien réparties. |
| Code de responsable | Square : sans la permission, il faut saisir un code de dérogation de responsable pour mettre en pause [15]. | non décrit | Fort. Le responsable de service débloque un remboursement sans donner son accès. |
| Rôles qui limitent vue et modification | Pikit : un compte par membre, rôles qui limitent ce que chacun voit et modifie [1]. | oui (à confirmer : un compte par personne ou par rôle) | Le journal n'a de valeur que si chaque personne a son compte. |
| Connexion renforcée | Pikit : passkey ou double authentification [1]. | non décrit | Fort pour l'accès qui rembourse. |
| Droit de clôturer la journée | Lightspeed K-Series a un droit « Allow End of Day » par utilisateur ou groupe. Non vérifié [R4]. | non | Moyen. |
| Journal d'audit | Toast « Ticket Details » trace chaque ticket [16]. | oui (journal avec annulation) | La Ferme est ici en avance sur ce qui a été lu. |

### 2.10 Mode dégradé

| Fonction | Qui la propose et comment | La Ferme | Intérêt |
|---|---|---|---|
| Arrêt des ventes quand le restaurant ne reçoit plus | Toast : la page cesse de prendre des commandes quand elles n'atteignent plus le restaurant, sous cinq minutes au plus. Même coupure si l'appareil de réception perd la connexion environ cinq minutes, pour que personne ne paie une commande que la cuisine ne verra pas [17]. | non | Très fort. C'est le risque numéro un d'un site maison : des commandes payées que personne ne voit. |
| Message au client pendant une panne longue | Toast : au-delà d'une heure, la page affiche que la commande en ligne est indisponible, avec adresse et téléphone [17]. | non décrit | Fort et simple. |
| Commandes périmées au retour | Toast recommande de confirmer avec le client avant de préparer une commande arrivée après coupure. Annulation possible [17]. | non décrit | Fort. Marquer « reçue avec retard » sur la tablette. |
| Souffler après la reprise | Toast conseille une pause de 20 ou 40 minutes au retour de la connexion [17]. | oui (pause) | Procédure à écrire, pas une fonction. |
| Liste de contrôle de reprise | Toast : quatre points à vérifier avant d'appeler le support [17]. | non | Fort. Une fiche plastifiée près de la tablette. |
| Réseau local sans internet | Lightspeed K-Series : prise de commande, impression des tickets cuisine et KDS continuent tant que le réseau local tient. Les données partent au retour d'internet [18]. | non décrit | Moyen. Pour La Ferme les commandes viennent d'internet, donc la coupure arrête tout de toute façon. |
| Paiement en panne | Lightspeed : paiements intégrés indisponibles hors ligne, terminaux en mode autonome avec 4G, paiements manuels (espèces) enregistrables [18]. Pikit : paiement à la remise possible [1]. | non décrit | Fort. Prévoir un basculement « paiement à la livraison » quand le prestataire de paiement tombe. |
| Tout est coupé | Lightspeed : sans réseau local, imprimantes et KDS s'arrêtent, seul le POS actif garde les données [18]. | non décrit | Avoir une connexion 4G de secours pour la tablette et les imprimantes. |
| Écran en secours de l'imprimante | Toast indique que le KDS hors ligne remplace les imprimantes de secours. Non vérifié [R5]. | non | Pour La Ferme le sens inverse compte : si une imprimante tombe, rerouter vers l'autre et afficher le ticket sur la tablette. Aucune page lue ne décrit ce reroutage. |

## 3. Ce qui ne vaut pas la peine pour La Ferme

| Fonction | Vue chez | Pourquoi l'écarter |
|---|---|---|
| Synchronisation de menus sur plusieurs plateformes | Otter [12], Deliverect [13] | La Ferme quitte Uber Eats. Un seul canal, une seule carte. |
| Gestion des litiges avec les plateformes | Otter « Dispute Management » [12] | Sans agrégateur, pas de litige de plateforme. |
| Alertes de canal déconnecté ou d'erreur d'injection POS | Otter [19] | Liées aux intégrations entre systèmes. La Ferme n'en a pas. |
| Comparaison entre établissements | Fresh KDS [2], Otter (réglage par marque et site) [19] | Un seul site. |
| Relais vers des coursiers tiers | Shipday [7], Uber Eats [5] | Le choix est de livrer avec des salariés. À garder en tête comme secours un soir d'absence, pas comme fonction à construire. |
| Attribution automatique et optimisation par IA | Onfleet [6], Shipday [7], Tookan [11] | Conçues pour des flottes dispersées. Tous les livreurs partent du même point avec peu de NPA. Une suggestion simple par zone suffit. |
| Réservation de tables, vitrine trilingue, nom de domaine | Pikit [1] | Hors du périmètre commande. |
| Cash back sur les achats fournisseurs | Otter [12] | Sans rapport avec la commande. |
| Commande par QR en salle, commande Facebook, commande en hôtel | GloriaFood [8], Otter [12] | Autres canaux. À rouvrir seulement si la salle le demande. |
| Barre de validation USB (« bump bar ») | Fresh KDS [2] | Un écran tactile suffit pour deux postes. |

## 4. Limites

Pages non lues ou bloquées.

- Toast, guide de plateforme (doc.toasttab.com) : erreur 403. Le détail du KDS Toast (passe, « all day », envoi échelonné, minuteur moyen) n'a pas été lu. Seuls les articles du centre d'aide support.toasttab.com l'ont été.
- Deliveroo Hub (help.deliveroo.com) : erreur 403. Rien de vérifié sur Deliveroo. Aucune affirmation sur Deliveroo dans ce rapport.
- Just Eat Partner Centre : la page d'aide redirige vers le portail connecté. Rien de vérifié. Les résultats de recherche évoquent une invite « trop occupé » sur l'Orderpad et un ajout de minutes aux délais pour les restaurants qui livrent eux-mêmes. Non vérifié [R3].
- GloriaFood : la page générale des fonctions renvoie une erreur 404. Seules deux pages ont été lues (application de prise de commande, marketing). Rien de vérifié sur les rapports détaillés, la liste de clients ou le blocage d'un client.
- Shipday : la page /features renvoie une erreur 404. La page d'accueil a été lue. Les pages de détail (preuve de livraison, rapports) ne l'ont pas été.
- Lightspeed K-Series : un seul article lu (mode hors ligne). Rien de vérifié sur la commande en ligne, les rapports ni les droits.
- Uber Eats Manager : seule la page de l'application de commandes a été lue. Rien de vérifié sur les rapports, les remboursements ni les notes.
- Deliverect : seul l'article sur les ruptures a été lu. Le mode occupé est connu par résultat de recherche. Non vérifié [R2].
- Otter : page d'accueil et page des alertes lues. Les pages analytics, KDS et gestion des commandes ne l'ont pas été.
- Toast Delivery Services : non lu. Un résultat de recherche indique que ce service ne s'applique pas quand les livreurs sont salariés du restaurant. Non vérifié [R7]. Le mode « Delivery Mode » pour livreurs internes a été lu [10].

Sujets sans source lue.

- Fiche client avec notes internes, clients à problème, liste de blocage.
- Avoirs distincts du remboursement.
- Rapports de ventes par plat, par zone, d'annulations et de remboursements.
- Planning des livreurs.
- Reroutage automatique d'une imprimante en panne.
- Étalement automatique des commandes selon le volume en direct.
- Prix : seul Pikit affiche des prix sur les pages lues (89, 139 et 199 CHF par mois TVA incluse, premier mois offert) [1]. Aucun autre prix n'a été relevé.

Réserves de méthode.

- Les pages ont été lues par un outil qui renvoie un extrait synthétisé, pas le texte brut. Les libellés entre guillemets sont ceux rendus par l'outil. Une formulation exacte destinée à être citée doit être revérifiée sur la page.
- Plusieurs pages sont des pages commerciales (Onfleet, Shipday, Tookan, Otter, Fresh KDS, Pikit). Elles disent ce que le produit annonce, pas comment il se comporte en service.
- Les articles Square lus viennent des aides États-Unis et Canada. La disponibilité en Suisse n'a pas été vérifiée. Toast n'est pas vendu en Suisse à ma connaissance. Non vérifié.
- La colonne « La Ferme » repose sur la description reçue. Chaque « non décrit » demande une vérification dans le dépôt avant d'être traité comme un manque.
- « Presque tous les outils » dans le résumé veut dire : au moins deux ou trois des outils lus. L'échantillon ne permet pas d'affirmer plus.

## 5. Sources

Toutes consultées le 13 novembre 2026.

Pages lues.

1. Pikit, page d'accueil. https://www.pikit.ch
2. Fresh KDS, page produit. https://www.fresh.technology/kds
3. Square, aide, écran de cuisine (KDS). https://squareup.com/help/us/en/article/7944-kds
4. Toast, aide, gérer le volume de commandes en ligne (délais et pauses). https://support.toasttab.com/en/article/Managing-Online-Order-Volume-Throttling-Orders-1492627940253
5. Uber Eats, centre d'apprentissage marchands (Suisse), application Uber Eats Orders. https://merchants.ubereats.com/ch/en/resources/learning-center/uber-eats-orders-app/
6. Onfleet, page livraison du dernier kilomètre. https://onfleet.com/last-mile-delivery
7. Shipday, page d'accueil. https://www.shipday.com/
8. GloriaFood, application de prise de commande. https://www.gloriafood.com/restaurant-order-taking-app
9. Square, aide (Canada), gérer le rythme des commandes. https://squareup.com/help/ca/en/article/8325-manage-order-timing-with-square
10. Toast, aide, Delivery Mode. https://support.toasttab.com/en/article/Delivery-Mode-1493048871021
11. Tookan (Jungleworks), page produit. https://jungleworks.com/tookan/
12. Otter, page d'accueil. https://www.tryotter.com/
13. Deliverect, aide, mettre des articles en rupture temporaire. https://help.deliverect.com/en/articles/7979011-snooze-items-to-temporarily-remove-them-from-menus
14. GloriaFood, logiciel de marketing. https://www.gloriafood.com/restaurant-marketing-software
15. Square, aide, gérer les commandes en ligne. https://squareup.com/help/us/en/article/6695-manage-your-online-orders-with-square
16. Toast, aide, rapports d'exploitation de la cuisine. https://support.toasttab.com/en/article/Kitchen-Reports-Overview
17. Toast, aide, pannes et perturbations de la commande en ligne. https://support.toasttab.com/en/article/Outages-and-Disruptions-Toast-Online-Ordering
18. Lightspeed Restaurant K-Series, aide, fonctionnement hors ligne du POS. https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality
19. Otter, Live Alerts. https://www.tryotter.com/products/live-alerts

Résultats de recherche, pages non ouvertes (tout ce qui s'y rapporte est non vérifié).

- R1. Toast, guide de plateforme, envoi en cuisine des commandes retardées et minuteur de temps moyen. https://doc.toasttab.com/doc/platformguide/adminFiringToastOnlineOrders.html et https://doc.toasttab.com/doc/platformguide/platformKitchenAvgFullfillmentTimer.html
- R2. Deliverect, mode occupé. https://help.deliverect.com/en/articles/7978972
- R3. Just Eat, gestion des commandes et délais. https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders et https://extrahelpings.just-eat.ie/how-update-your-order-times
- R4. Lightspeed K-Series, droits et rapports de fin de journée. https://k-series-support.lightspeedhq.com/hc/articles/360051071413
- R5. Toast, mode hors ligne. https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode
- R6. Uber, pause automatique des marchands. https://www.uber.com/au/en/blog/automatic-pausing-for-merchants
- R7. Toast, gestion des livraisons internes et Toast Delivery Services. https://doc.toasttab.com/doc/platformguide/platformManagingDeliveryOrders.html
- R8. Square, forum communautaire, étalement des commandes de retrait et de livraison. https://community.squareup.com/t5/Square-for-Restaurants/How-does-the-quot-Space-out-pickup-amp-delivery-orders-quot/m-p/211968

Pages en erreur.

- https://doc.toasttab.com/doc/platformguide/adminKDSOverview.html (403)
- https://help.deliveroo.com/en/articles/2408618-how-to-give-yourself-more-time-to-prepare-food-with-busy-mode (403)
- https://www.gloriafood.com/restaurant-ordering-system-features (404)
- https://www.shipday.com/features (404)
- https://partner.just-eat.co.uk/knowledge-centre/how-to-manage-your-orders (redirection vers le portail connecté)
