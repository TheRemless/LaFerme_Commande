# Chiffres du back-office (vague 3, bo-pilotage)

## Tableau des ventes

Calculés en base, jamais dans le navigateur. Migration `supabase/migrations/20261129090000_pilotage_ventes.sql`, module `src/lib/pilotage.ts`, route `GET /api/gestion/pilotage/ventes` (gérant). Tests : `tests/unit/pilotage-ventes-sql.test.ts`, `tests/unit/pilotage.test.ts`.

| Chiffre | Définition |
|---|---|
| Jour d'une commande | Son jour de service (`jour_service`), qui change à 5h du matin à Genève. L'export comptable garde, lui, le jour de la commande (`jour`) |
| Commande prise | Ni refusée, ni annulée, ni en attente de paiement. Encaissée ou encore à encaisser au comptoir |
| TTC | Total payé par le client, frais de livraison compris. HT = TTC moins la TVA de la commande |
| Panier moyen | TTC des commandes prises divisé par leur nombre |
| Encaissé, à encaisser | Payé en ligne ou encaissé au comptoir ; commandes au comptoir pas encore encaissées |
| Remboursements faits | Au jour de service où ils sont faits (de 5h à 5h, heure de Genève), comme les ventes, sans ceux d'une commande refusée. L'export comptable garde le jour civil |
| Remboursements en cours, en échec | Au jour de service de la demande, refusées comprises |
| Net TTC | TTC moins remboursements faits. TVA par taux : ventes, remboursements et net |
| Taux de TVA | Un seul taux par commande, le réglage `tva_emporter_pourcent` (2,6 %) au moment de la commande. Juste tant que la carte en ligne n'a aucune boisson alcoolisée (8,1 %) : vérifié le 13.11.2026 sur `docs/carte-proposee.json` et le jeu de rush. Un plat à 8,1 % ajouté au back-office serait compté à 2,6 % |
| Refus | Refus du restaurant seulement : nombre, montant et les huit motifs les plus fréquents (majuscules et espaces ignorés). Une annulation par le client avant l'acceptation (`annulee_par_client_le`) se compte à part (`annulees_client`), migration `20261210170000_annulation_client_chiffres.sql` |
| Service | `&service=midi` ou `&service=soir` : un seul service, comparé au même service. Une commande est du soir si son heure confirmée, sinon son créneau, sinon l'heure où elle a été passée, est à 15h ou plus tard (même bascule que le plat du jour). Un remboursement suit l'heure où il a été fait |
| Comparaison | Sans choix : les mêmes jours de la semaine précédente pour moins de 7 jours, sinon la même durée juste avant. Le mois se compare au mois civil précédent. La semaine va du lundi au dimanche |

Paramètres de la route : `?periode=jour|semaine|mois&jour=AAAA-MM-JJ`, ou `?periode=choisie&debut=…&fin=…` (et `&comp_debut=…&comp_fin=…`). Un an au plus de chaque côté. Les fonctions SQL ne s'exécutent que pour le serveur (`service_role`) et ne rendent aucune donnée personnelle.

Mesure (`npx tsx --conditions=react-server scripts/mesure-pilotage.ts`, base embarquée, 109 500 commandes sur un an, 13.11.2026) : un jour 3 ms, une semaine 5 ms, un mois 19 ms, une année 138 ms, comparaison comprise. Avec un seul service (Mac chargé par les autres sessions, deuxième passage) : un soir 9 ms, un mois de soirs 37 ms ; dans ce même passage, le mois entier 30 ms et l'année 235 ms. Aucune table de cumuls nécessaire à ce volume.

## Clôture du jour (rapport Z)

Migration `supabase/migrations/20261210190000_cloture_jour.sql`, module `src/lib/cloture.ts`, route `/api/gestion/cloture` (gérant). Tests : `tests/unit/cloture-jour-sql.test.ts`, `tests/unit/cloture.test.ts`.

- Un jour de service va de 5h à 5h le lendemain (heure de Genève). Les ventes sont celles du tableau des ventes pour ce jour. Les remboursements sont ceux faits (ou demandés, s'ils ne sont pas faits) dans cette fenêtre, comme dans le tableau des ventes. L'export comptable, lui, compte un remboursement au jour civil.
- Encaissements : en ligne (TWINT et carte ensemble tant que la commande ne garde pas le moyen de Stripe), comptoir (net des manques déduits avant l'encaissement), espèces rendues, et l'attendu au comptoir (comptoir moins espèces rendues). Depuis que la tablette note le moyen (#115, migration `20261212090000_cloture_moyens.sql`) : comptoir en espèces, en carte et moyen pas noté, espèces attendues dans le tiroir (espèces moins espèces rendues) et carte attendue sur le ticket du terminal. L'écart enregistré reste celui du total ; un jour clôturé avant ne passe pas pour « changé ».
- À encaisser : chaque commande au comptoir pas encore encaissée, avec son numéro, son heure et le montant dû.
- À vérifier : remise au client sans encaissement, remboursement en échec ou pas encore confirmé, une ligne par commande. Les commandes pas terminées tiennent en une ligne (« 87 commandes pas terminées, CHF …, 40 prêtes, 30 parties… ») qui se déplie sur le détail à l'écran et ne s'imprime que résumée. Elles ne bloquent pas la clôture. Le CSV garde une ligne par commande.
- Clôturer (`POST { jour, especes, carte, note }`, montants en francs, vides si pas comptés) : la base garde une copie du rapport, calcule l'écart (espèces comptées + ticket du terminal de carte − attendu) et journalise (objet `cloture`, sans le rapport). Reclôturer le même jour remplace la clôture ; l'ancienne reste dans le journal. Un jour clôturé se relit tel qu'il était à la clôture ; si une commande ou un remboursement du jour a changé depuis (`change_depuis`), l'écran et le CSV le disent : il faut reclôturer. Une clôture ne s'annule pas depuis le journal. Pas de clôture d'un jour à venir.
- `GET ?jour=…&format=csv` : le rapport en CSV (point-virgule), sans aucune donnée de client, formules neutralisées.
- Mesure (base embarquée, un jour de 300 commandes dans un an d'historique) : 3 ms.

### Écran (`/gestion/cloture`)

`src/components/gestion/ClotureJour.tsx` et `cloture.css`, kit du back-office. Test : `tests/e2e/gestion-cloture.spec.ts`. Captures sur le jeu de rush : `docs/rendus/vague-3/bo-pilotage/cloture-bureau.png`, `cloture-mobile.png`, `cloture-impression.pdf` (une page A4 pour un jour de 322 commandes).

- Jour de service (date, « Aujourd'hui », « Hier »), jamais un jour à venir.
- Encaissé (en ligne, comptoir, déduit, espèces rendues, attendu au comptoir), puis « Compter la caisse » : espèces comptées, ticket du terminal de carte, note. Un montant illisible est refusé sous son champ. « Clôturer le jour » demande confirmation en donnant l'attendu, le compté et l'écart. Un jour clôturé montre l'écart, garde ses montants dans les champs et propose « Reclôturer ». Si une commande du jour a changé depuis, un bandeau le dit.
- Comptoir pas encore encaissé, à vérifier, remboursements du jour, ventes et TVA.
- « Imprimer » : une page A4 sans menu ni formulaire. « Télécharger (CSV) » : le même rapport en fichier.

## Analyses

Migration `supabase/migrations/20261210200000_pilotage_analyses.sql`, route `GET /api/gestion/pilotage/analyses` (mêmes paramètres que les ventes, sans comparaison). Tests : `tests/unit/pilotage-analyses-sql.test.ts`.

- Plats : quantité et montant TTC des lignes (suppléments compris, frais de livraison non), sous le nom actuel de la carte. Un plat qui n'est plus à la carte garde son dernier nom vendu, dans « Hors carte ».
- Catégories : la même chose par catégorie de la carte.
- Heures : carte de chaleur par jour de la semaine (1 = lundi) et heure de service à Genève (heure confirmée, sinon créneau, sinon heure de la commande), avec le nombre de ces jours dans la période pour une moyenne.
- Zones : commandes livrées, montant, frais et panier moyen par zone.
- Clients : un client se reconnaît à son e-mail (sans majuscules) à l'intérieur de la base. Nouveau : aucune commande prise avant la période. Fidèle : au moins une. Seuls des nombres sortent.
- Mesure (base embarquée, 109 500 commandes et 328 500 lignes sur un an) : un mois en 61 ms, une année en environ 1 s. Pas de table de cumuls : une année entière reste une demande rare, l'écran montre un chargement.

## Export pour la fiduciaire et remboursements à suivre

Migration `supabase/migrations/20261129120000_export_compta.sql`, module `src/lib/export-compta.ts`. Tests : `tests/unit/export-compta-sql.test.ts`.

- `GET /api/gestion/export?debut=…&fin=…&format=jours` : une ligne par jour et par taux de TVA (ventes, en ligne, comptoir, dont livraison, TTC, TVA, remboursé en ligne, rendu en espèces, déduit au comptoir, TVA remboursée, net TTC, TVA nette, net HT), puis le total de la période par taux. Mêmes règles que le détail (`export_ventes`, `export_remboursements`) : une vente au jour de la commande, un remboursement au jour civil où il est fait. Les totaux tombent juste avec le détail, au centime (testé).
- Ce CSV n'a aucun numéro de compte : il s'ouvre dans un tableur. Pour la comptabilité, l'export Crésus ci-dessous.
- `GET /api/gestion/pilotage/remboursements` : remboursements en échec, ou demandés à Stripe il y a plus de 24 heures sans confirmation, les plus anciens d'abord, avec l'identifiant de la commande pour ouvrir sa fiche.

## Export pour Crésus Comptabilité (D9)

Décision de Jérémy du 13.11.2026 : la comptabilité se tient au restaurant avec Crésus Comptabilité (Epsitec), taux de 2,6 % confirmé. Migration `supabase/migrations/20261214120000_export_cresus.sql`, module `src/lib/export-cresus.ts`, écran « Export comptable » (choix « Écritures pour Crésus » et plan de comptes). Tests : `tests/unit/export-cresus.test.ts`, `tests/unit/export-cresus-sql.test.ts`, `tests/e2e/gestion.spec.ts`.

### Format, d'après Epsitec

Source : manuel Crésus Comptabilité, § 19.2 « Importer des données », page [support.cresus.ch/manuels/cresus-comptabilite/importer-des-donnees-236](https://support.cresus.ch/manuels/cresus-comptabilite/importer-des-donnees-236/) et PDF [cresus-comptabilite-1-232.pdf](https://support.cresus.ch/wp-content/documentation/1/cresus-comptabilite-1-232.pdf) (« © 2026 - EPSITEC »), lus le 13.11.2026. Complément : [Puis-je importer des écritures comptables ?](https://support.cresus.ch/puis-je-importer-des-ecritures-comptables/) (11.9.2023).

| Point | Ce que dit Epsitec | Ce que fait l'export |
|---|---|---|
| Fichier | Texte, une écriture par ligne, champs séparés par une tabulation, lignes par CR+LF | Pareil, extension `.txt` |
| Champs | Format simple : date (jj.mm.aaaa), compte au débit, compte au crédit, numéro de pièce, libellé, montant | Les six, dans cet ordre |
| Numéro de pièce | Vide : Crésus prend le suivant selon les options d'importation | Vide |
| Comptes | Doivent exister dans le plan comptable, Crésus fait un test de plausibilité | Plan réglable par le gérant |
| Encodage | Pas dit | ASCII seul (accents retirés des libellés) : identique en Windows-1252 et en UTF-8 |
| Montants | Pas de règle, l'exemple écrit « 92.95 » | Point décimal, deux décimales, sans séparateur de milliers |
| En-tête | Pas dit | Aucune ligne d'en-tête |
| Format étendu (codes TVA, écritures multiples) | 20 champs sur la page web, 19 dans le PDF (« Période » en plus sur la page), et l'exemple ne suit pas la liste | Pas utilisé tant qu'un fichier exporté par le Crésus du restaurant ne le tranche pas |

Conséquence du format simple : les montants sont justes, mais Crésus ne rattache pas la TVA à un code TVA. Le décompte TVA se fait sur le compte TVA due, ou avec le format étendu une fois vérifié.

### Écritures

Par jour, par moyen d'encaissement (en ligne, comptoir en espèces, comptoir à la carte) :

| Écriture | Débit | Crédit | Montant |
|---|---|---|---|
| Ventes HT | moyen | ventes | TTC moins TVA moins frais de livraison HT |
| Frais de livraison HT | moyen | frais de livraison | frais TTC moins leur TVA |
| TVA des ventes | moyen | TVA due | TVA des commandes |
| Remboursements HT | remboursements | moyen | remboursé moins sa TVA |
| TVA des remboursements | TVA due | moyen | TVA du remboursement |

- Mêmes règles que le récapitulatif par jour : vente au jour de la commande, remboursement au jour où il est fait, sans commande refusée ni annulée. Les totaux tombent juste avec lui, au centime (testé).
- En ligne : TWINT et cartes ensemble, la base ne les distingue pas et Stripe les verse ensemble. Les frais de Stripe ne sont pas dans le fichier. Ils se voient sur les versements de Stripe (rapprochement en attente de Jérémy).
- Comptoir dont le moyen n'a pas été noté : compté en espèces. Manque déduit au comptoir : sort du moyen de la commande.
- Une période avec deux taux de TVA est refusée avec un message : le plan n'a qu'un compte de ventes.

### Plan de comptes proposé, à confirmer

Rangé dans `reglages_prives` (`plan_comptes_cresus`), lu par le serveur seulement. L'écran le marque « à confirmer » tant que le gérant ne l'a pas enregistré. Chaque compte changé va au journal (« Plan de comptes Crésus »). Numéros pris dans la structure du plan comptable PME suisse, à vérifier dans le plan de Crésus du restaurant.

| Rôle | Compte proposé |
|---|---|
| Caisse (espèces au comptoir) | 1000 |
| Stripe (TWINT et cartes en ligne) | 1090 |
| Terminal de cartes au comptoir | 1091 |
| TVA due | 2200 |
| Ventes 2,6 % | 3200 |
| Frais de livraison | 3400 |
| Remboursements aux clients | 3800 |

Avant le premier vrai import : exporter une semaine, l'importer dans une copie de la comptabilité et comparer avec la clôture du jour.

