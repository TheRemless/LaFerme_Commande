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
| Refus | Nombre, montant et les huit motifs les plus fréquents (majuscules et espaces ignorés) |
| Service | `&service=midi` ou `&service=soir` : un seul service, comparé au même service. Une commande est du soir si son heure confirmée, sinon son créneau, sinon l'heure où elle a été passée, est à 15h ou plus tard (même bascule que le plat du jour). Un remboursement suit l'heure où il a été fait |
| Comparaison | Sans choix : les mêmes jours de la semaine précédente pour moins de 7 jours, sinon la même durée juste avant. Le mois se compare au mois civil précédent. La semaine va du lundi au dimanche |

Paramètres de la route : `?periode=jour|semaine|mois&jour=AAAA-MM-JJ`, ou `?periode=choisie&debut=…&fin=…` (et `&comp_debut=…&comp_fin=…`). Un an au plus de chaque côté. Les fonctions SQL ne s'exécutent que pour le serveur (`service_role`) et ne rendent aucune donnée personnelle.

Mesure (`npx tsx --conditions=react-server scripts/mesure-pilotage.ts`, base embarquée, 109 500 commandes sur un an, 13.11.2026) : un jour 3 ms, une semaine 5 ms, un mois 19 ms, une année 138 ms, comparaison comprise. Avec un seul service (Mac chargé par les autres sessions, deuxième passage) : un soir 9 ms, un mois de soirs 37 ms ; dans ce même passage, le mois entier 30 ms et l'année 235 ms. Aucune table de cumuls nécessaire à ce volume.

## Clôture du jour (rapport Z)

Migration `supabase/migrations/20261210190000_cloture_jour.sql`, module `src/lib/cloture.ts`, route `/api/gestion/cloture` (gérant). Tests : `tests/unit/cloture-jour-sql.test.ts`, `tests/unit/cloture.test.ts`.

- Un jour de service va de 5h à 5h le lendemain (heure de Genève). Les ventes sont celles du tableau des ventes pour ce jour. Les remboursements sont ceux faits (ou demandés, s'ils ne sont pas faits) dans cette fenêtre, comme dans le tableau des ventes. L'export comptable, lui, compte un remboursement au jour civil.
- Encaissements : en ligne (TWINT et carte ensemble tant que la commande ne garde pas le moyen de Stripe), comptoir (net des manques déduits avant l'encaissement), espèces rendues, et l'attendu au comptoir (comptoir moins espèces rendues).
- À encaisser : chaque commande au comptoir pas encore encaissée, avec son numéro, son heure et le montant dû.
- À vérifier : remise au client sans encaissement, remboursement en échec ou pas encore confirmé, commande pas terminée.
- Clôturer (`POST { jour, especes, carte, note }`, montants en francs, vides si pas comptés) : la base garde une copie du rapport, calcule l'écart (espèces comptées + ticket du terminal de carte − attendu) et journalise (objet `cloture`, sans le rapport). Reclôturer le même jour remplace la clôture ; l'ancienne reste dans le journal. Un jour clôturé se relit tel qu'il était à la clôture ; si une commande ou un remboursement du jour a changé depuis (`change_depuis`), l'écran et le CSV le disent : il faut reclôturer. Une clôture ne s'annule pas depuis le journal. Pas de clôture d'un jour à venir.
- `GET ?jour=…&format=csv` : le rapport en CSV (point-virgule), sans aucune donnée de client, formules neutralisées.
- Mesure (base embarquée, un jour de 300 commandes dans un an d'historique) : 3 ms.

## Analyses

Migration `supabase/migrations/20261129110000_pilotage_analyses.sql`, route `GET /api/gestion/pilotage/analyses` (mêmes paramètres que les ventes, sans comparaison). Tests : `tests/unit/pilotage-analyses-sql.test.ts`.

- Plats : quantité et montant TTC des lignes (suppléments compris, frais de livraison non), sous le nom actuel de la carte. Un plat qui n'est plus à la carte garde son dernier nom vendu, dans « Hors carte ».
- Catégories : la même chose par catégorie de la carte.
- Heures : carte de chaleur par jour de la semaine (1 = lundi) et heure de service à Genève (heure confirmée, sinon créneau, sinon heure de la commande), avec le nombre de ces jours dans la période pour une moyenne.
- Zones : commandes livrées, montant, frais et panier moyen par zone.
- Clients : un client se reconnaît à son e-mail (sans majuscules) à l'intérieur de la base. Nouveau : aucune commande prise avant la période. Fidèle : au moins une. Seuls des nombres sortent.
- Mesure (base embarquée, 109 500 commandes et 328 500 lignes sur un an) : un mois en 61 ms, une année en environ 1 s. Pas de table de cumuls : une année entière reste une demande rare, l'écran montre un chargement.
