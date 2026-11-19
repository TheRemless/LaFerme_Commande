# Comptes justes au droit suisse : état et plan

Demande de Jérémy du 19.11.2026 : « mieux que les comptes soient justes, regarde par rapport aux lois suisses ». Référence : [tva-et-cagnotte.md](tva-et-cagnotte.md) (règles R1 à R35, questions F1 à F16). État comparé sur `main` à cfada7c9. Pilote : bo-pilotage.

Aucune écriture ne part vers le Crésus du restaurant. Le site produit des fichiers que la fiduciaire valide. Tout point qui dépend d'une question F devient un réglage, avec par défaut la valeur la plus prudente, pour que sa réponse se règle sans nouvelle version.

## Ce qui commande le reste

- **F1 (méthode effective ou taux de la dette fiscale nette)** change l'échelle de presque tout. Le code reste le même (ventes et TVA par taux), mais l'usage des chiffres change. À poser en premier.
- **Le ticket fixe le taux.** Sans la mention de livraison ou d'emporter sur le justificatif, l'AFC présume 8,1 % sur tout (R6). C'est le risque le plus cher. C'est aussi le plus simple à corriger.
- **La carte n'a pas d'alcool aujourd'hui** (vérifié le 13.11.2026). Tant que c'est vrai, un seul taux par commande reste juste. Le taux par plat (R1, R3) doit exister avant la première boisson alcoolisée.

## Règle par règle

États : « juste » (déjà conforme sur main), « à corriger » (avec l'équipe qui s'en charge), « bloqué F » (le code suit un réglage en attendant la fiduciaire), « sans objet ».

| N° | Règle (résumé) | État sur main | Qui | Constat |
|---|---|---|---|---|
| R1 | Canal obligatoire, taux de chaque ligne calculé, jamais saisi | à corriger | bo-carte | `commandes.mode` existe (livraison ou retrait, pas de sur place). Le taux est unique par commande (réglage `tva_emporter_pourcent`, `src/lib/catalogue.ts`), pas par ligne |
| R2 | Nourriture et boissons ≤ 0,5 % vol., livraison ou emporter : 2,6 % | juste | aucune | 2,6 % pour toute commande |
| R3 | Alcool > 0,5 % vol. : 8,1 % partout, champ teneur en alcool | à corriger | bo-carte | Aucun champ teneur ni taux par plat. Pas d'alcool à la carte aujourd'hui |
| R4 | Sur place ou service chez le client : 8,1 % sur tout | sans objet | aucune | Le site ne vend ni sur place ni avec service |
| R5 | Taux dans une table datée, aucun taux en dur | à corriger | bo-carte | Un réglage sans date de validité |
| R6 | Mention « Livraison sans préparation ni service à » + nom et adresse, ou « À l'emporter » | à corriger | tablette, client-compte | Le reçu dit « Livraison » ou « À emporter », sans la mention ni l'adresse (`src/lib/recu.ts` exclut l'adresse car le lien de suivi se transmet) |
| R7 | Raison sociale, localité, n° TVA, date, article avec prix et taux, total | à corriger | tablette, client-compte | Le reçu porte raison sociale, adresse, CHE-103.250.692 TVA, date, articles et total, mais un seul taux en bas. Le taux par ligne viendra avec R1 |
| R8 | Frais d'une commande sans alcool : 2,6 % | juste | aucune | Les frais suivent le taux de la commande |
| R9 | Frais d'une commande mixte : réglage (prorata ou 8,1 %) | bloqué F3 | bo-carte | Réglage à créer, défaut prudent 8,1 % sur les frais d'une commande mixte |
| R10 | Pourboire hors TVA, compte de passage | sans objet | aucune | Le site ne prend pas de pourboire. À reprendre s'il en ajoute un |
| R11 | Avoir numéroté par remboursement : commande, articles, montants, taux, TVA, id Stripe | à corriger | bo-pilotage | `remboursements` garde la commande, le montant, les articles (`elements`, s'il y en a) et `stripe_refund_id`, sans numéro d'avoir ni TVA par taux |
| R12 | Avoir exporté à la date du remboursement | juste | aucune | Clôture, récap et Crésus prennent `fait_le` |
| R13 | Remboursement au taux de l'article, global ventilé selon la clé | à corriger, en partie bloqué F4 | bo-pilotage, bo-carte | Juste tant qu'il n'y a qu'un taux. Ventilation par article dès R1 |
| R14 | Code promo et geste en ligne de rabais au débit d'un compte de diminution de recettes | à corriger | bo-pilotage | Les ventes sortent nettes (`remise_centimes` déduit) : TVA juste, mais pas de trace du rabais |
| R15 | Rabais, cagnotte ou parrainage d'une commande mixte réparti entre taux, au centime | bloqué F4 | bo-carte | Réglage à créer, défaut prorata, somme exacte au centime |
| R16 | Plat offert : ligne à 0 ou prix avec rabais égal ; hors commande, journalisé par client | à vérifier | bo-commandes | Le geste « plat offert » existe (réclamations), sa trace en valeur par client n'est pas vérifiée |
| R17 | Complément rattaché à la commande, taux de l'article ajouté, clôture du jour d'encaissement | à corriger | bo-pilotage, bo-commandes | Rattaché, oui. Compté au jour de service de la commande, pas au jour d'encaissement (identiques sauf cas rare). Taux de la commande, pas de l'article |
| R18 | Vente au brut par moyen (Stripe carte, Stripe TWINT, terminal, espèces), commission en charge | à corriger | bo-pilotage | Brut, oui. TWINT et cartes confondus, commission Stripe absente de la base |
| R19 | Liaison Stripe nulle après chaque versement, un écart bloque l'export | à corriger | bo-pilotage | Aucun suivi des versements Stripe |
| R20 | Clôture horodatée : par moyen et par taux, remboursements, rabais, cagnotte, pourboires, comptage, écart, caisse jamais négative | à corriger | bo-pilotage | Par moyen, remboursements, comptage, écart : oui. Par taux, rabais, cagnotte utilisée : non |
| R21 | Rien de supprimable, chaque modification tracée, export figé mensuel | à corriger | bo-commandes, bo-pilotage | Une modification de commande efface les anciennes lignes (`delete from commande_lignes`) et un complément dû réduit à zéro est supprimé. Aucun export figé mensuel |
| R22 | Conservation dix ans | à vérifier | chef, fiduciaire | Aucune purge des commandes trouvée. Durée déjà posée à la fiduciaire (`docs/mise-en-ligne.md`) |
| R23 | Gain de cagnotte sans TVA | juste | aucune | Aucun mouvement de TVA au gain |
| R24 | Ticket : prix brut, cagnotte déduite, TVA sur le net | juste sur le reçu | tablette | Le reçu montre plats, livraison, « Cagnotte utilisée », total et TVA sur le net. Le ticket papier ne porte aucun prix |
| R25 | Solde de cagnotte affiché sans TVA | juste | aucune | Aucune mention de TVA dans `CagnotteCompte` |
| R26 | Expiration sans TVA, journalisée | juste | aucune | Mouvement `expire` daté |
| R27 | État des soldes non expirés au 31.12, par client et total | à corriger | bo-pilotage | `du_cagnottes_au(date)` donne le total et le nombre de comptes, pas la liste par compte |
| R28 | Journal de cagnotte complet (origine, parrain et filleul, commande) | à corriger | client-compte | Parrain et filleul ont le même type `parrainage`, distingués par le motif seulement |
| R29 | Crédit du parrain sur un type distinct | à corriger, traitement bloqué F13 | client-compte | Voir R28 |
| R30 | Crésus : .txt, tabulation, CR+LF, jj.mm.aaaa, format étendu | à corriger | bo-pilotage | Format simple à six champs (PR #231) |
| R31 | Une écriture multiple par taux et par liaison : HT, TVA, TTC, champs 9 à 13 | à corriger | bo-pilotage | Écritures simples, TVA en écriture à part, sans code TVA |
| R32 | Codes TVA et comptes lus du dossier Crésus, jamais devinés | à corriger | bo-pilotage | Comptes réglables (proposés, à confirmer). Codes TVA : aucun réglage |
| R33 | Point décimal, sans apostrophe, encodage à confirmer | juste, encodage à confirmer | aucune | ASCII seul, point, pas de milliers |
| R34 | Test d'acceptation : une journée saisie à la main dans Crésus, comparée champ par champ | bloqué (humain) | Jérémy, fiduciaire | Il faut un export de leur dossier Crésus. Le site fournira la journée type |
| R35 | Impôt sur les acquisitions (Netlify et services étrangers) | hors code, bloqué F7 | fiduciaire | Écriture de la fiduciaire sur facture |

Sur 35 règles : 7 justes, 1 juste en partie (R24), 3 sans objet ou hors code (R4, R10, R35), 23 à corriger ou à vérifier dont 4 suivent une réponse F (R9, R13, R15, R29) et 1 bloquée par un test humain (R34).

## Contrat partagé : la ventilation par taux

Pour que les exports n'aient pas à changer quand le taux par plat arrive, bo-pilotage crée deux fonctions qui donnent, pour une commande et pour un remboursement, les montants par taux. Aujourd'hui elles rendent un seul taux, celui de la commande. bo-carte les recrée (`create or replace`, mêmes signatures) quand les lignes portent leur taux.

- `ventilation_commande(o commandes) returns jsonb` : `[{ taux, ttc, tva, frais_ttc, frais_tva, rabais_ttc, cagnotte_ttc }]`. `ttc` est le payé net à ce taux, `rabais_ttc` et `cagnotte_ttc` la part du rabais et de la cagnotte à ce taux. Somme des `ttc` = `total_centimes`, somme des `tva` = `tva_centimes`, au centime.
- `ventilation_remboursement(r remboursements) returns jsonb` : `[{ taux, ttc, tva }]`, par article quand `elements` les donne, sinon selon la clé du réglage F4. Somme des `ttc` = `montant_centimes`.

Clôture, récapitulatif, Rapports et Crésus ne lisent plus `taux_tva_pourcent` directement : ils passent par ces fonctions.

## Ordre des PR

Plages de migration données par le chef : bo-pilotage 20261217130000 à 20261217140000, bo-carte 20261217150000, tablette 20261217160000.

| Ordre | PR | Équipe | Règles | Dépend de |
|---|---|---|---|---|
| 1 | Ventilation par taux (les deux fonctions, un seul taux), réglages des codes TVA, Crésus au format étendu (écritures multiples HT, TVA, TTC), ventes au brut avec ligne de rabais et de cagnotte, avoirs numérotés, clôture par taux avec rabais et cagnotte utilisée | bo-pilotage | R11, R12, R14, R20, R30 à R33 | rien |
| 2 | Taux par plat (table datée, teneur en alcool, choix au back-office), taux et TVA par ligne de commande, réglages frais mixtes et répartition des rabais, recréation des deux fonctions de ventilation | bo-carte | R1, R3, R5, R9, R13, R15 | 1 |
| 3 | Mentions du justificatif (ticket et reçu e-mail), taux par ligne avec légende | tablette, client-compte pour l'e-mail | R6, R7, R24 | 2 pour le taux par ligne, la mention peut partir avant |
| 4 | Commission Stripe et séparation TWINT et cartes (lues chez Stripe au paiement), suivi des versements, liaison nulle, export figé mensuel, état des soldes de cagnotte au 31.12 par compte | bo-pilotage | R18, R19, R21 (export), R27 | 1 |
| 5 | Historique des lignes d'une commande modifiée et des compléments, plat offert tracé en valeur | bo-commandes | R16, R17, R21 | 1 |
| 6 | Type distinct parrain et filleul | client-compte | R28, R29 | rien |

La mention du justificatif (début de 3) peut partir tout de suite, sans attendre 2 : c'est le risque le plus cher.

## Pour la fiduciaire

Les 16 questions F1 à F16 sont dans [tva-et-cagnotte.md](tva-et-cagnotte.md). Le site lui donnera, avant toute décision, une journée type exportée (R34) et l'état des soldes de cagnotte au 31.12 (R27).

## Avancement

- PR 1 (bo-pilotage, 20261217130000) : ventilation par taux, avoirs numérotés, codes TVA en réglage, comptes de rabais et de cagnotte, Crésus au format étendu. Couvre R11, R12, R14, R30 à R32. La clôture par taux, le rabais et la cagnotte utilisée à la clôture (R20) suivent dans une PR à part, avant que bo-carte n'active un second taux.

