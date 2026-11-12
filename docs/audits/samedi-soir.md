# Audit « samedi soir » : fiabilité pendant un gros service

Audit du 12.11.2026, sur `main` au commit d95375f. Aucun code de `src/`, aucune migration ni aucun réglage Netlify ou Supabase modifié.

Terrain : une seule instance locale (`BASE_LOCALE=1 npm run build`, puis `next start -p 3102`) avec la base embarquée PGlite. Aucune requête vers la préversion ni vers Supabase. Les seuls appels sortants sont deux lectures du registre fédéral des adresses (geo.admin.ch, mises en cache par le serveur) pour les livraisons. Stripe et Resend sont remplacés par leurs doublures.

Scripts jetables, sur cette branche, dans `scripts/audit/` :

| Script | Ce qu'il fait |
|---|---|
| `service-charge.mjs` | Service simulé de 37 minutes : 58 tentatives de commande (47 clients et 11 commandes d'essai pour sonder la pause), pointes de 5 commandes à la même seconde, deux tablettes, deux fausses imprimantes Star CloudPRNT, panne d'imprimante, pause manuelle, tablettes coupées du réseau |
| `base.audit.test.ts` | 18 tests sur la base embarquée avec une horloge réglable (minuit, numéros, pause automatique, alertes, impression) |
| `remboursement.audit.test.ts` | 4 tests : refus avec Stripe en panne, double appui, accepter et refuser en même temps |
| `heures.audit.test.ts` | 5 tests : heure d'été et d'hiver, changement de jour, ticket d'une commande à l'avance |
| `tablette-reseau.mjs` | La vraie page `/tablette` dans Chrome : coupure réseau, geste hors ligne, rechargement |

Les trois fichiers `*.audit.test.ts` figeaient les bugs observés. Ils figurent dans le premier commit de la PR des corrections (« Audit samedi soir ») et ont été retirés ensuite : les tests de non-régression qui les remplacent sont `tests/unit/service-correctifs-sql.test.ts`, `tests/unit/service-correctifs.test.ts` et `tests/unit/tablette-signe.test.ts`. `scripts/audit/verifier-correctifs.mjs` rejoue les corrections de bout en bout avec le faux client CloudPRNT.

## Suivi des corrections (13.11.2026)

| Constat | État | Comment |
|---|---|---|
| SS-01 | corrigé | `pause_automatique()` n'est bloquée que par une pause réellement en cours |
| SS-02 | corrigé | Capacité contrôlée en base sous verrou (`creer_commande`), réglable dans le back-office (« Commandes par créneau »), valeurs déjà en base gardées (3 livraisons, 4 retraits). Les « dès que possible » ne comptent pas : choix à confirmer par Jérémy. Le client voit le refus au paiement, le créneau n'est pas encore grisé dans la liste |
| SS-03 | corrigé | Tickets en file annulés, ticket « ANNULÉE, NE PAS PRÉPARER » aux postes qui avaient déjà le leur |
| SS-04 | corrigé | E-mail « refusée, remboursement en cours » au client, alerte au restaurant, bandeau sur la tablette, commande gardée jusqu'au remboursement |
| SS-05 | corrigé | Numéro du jour de service (colonne `jour_service`), `jour` reste la date de vente |
| SS-06 | corrigé | La tablette envoie l'état qu'elle affichait, contrôlé par `changer_statut` |
| SS-07 | corrigé | « RENVOI : CE TICKET EST PEUT-ÊTRE DÉJÀ SORTI » en tête du ticket renvoyé |
| SS-08 | corrigé | Avertissement noté au paiement (pause, plat épuisé, heure dépassée), affiché sur la carte de la commande |
| SS-09 | corrigé | Alerte seulement pendant les heures de service, attente comptée depuis le paiement |
| SS-10 | corrigé | Signe de vie seulement d'un appareil qui a touché « Démarrer le service » (ou « Continuer sans son ») |
| SS-12 | corrigé | « Ticket non créé » et « Réimprimer » sur toute commande acceptée |
| SS-15 | corrigé | Clé d'idempotence Resend calculée sur le sujet et le texte |
| SS-16 | corrigé | Le second appui voit la commande remboursée et le dit |
| SS-17 | corrigé | Pas de second ticket tant que le premier attend en file |
| SS-18 | corrigé en partie | Le son est relancé au retour de veille ; l'écran « Démarrer le service » après un rechargement reste (règle des navigateurs) |
| SS-19 | corrigé | Une imprimante ajoutée ou réactivée reprend les tickets « sans imprimante » des commandes en cours |
| SS-20 | corrigé | Verrou sur la clé d'idempotence dans `creer_commande` (à rejouer contre Supabase, R-01) |
| G01 (audit du gérant) | corrigé | « Retirée et payée » d'un geste au comptoir, « Encaissée » encore possible dans « Terminées » |
| SS-11, G08 option A (13.11.2026) | corrigé | Une commande acceptée pour plus tard reste dans « À l'avance ». La surveillance crée ses tickets à l'heure promise moins le réglage « Tickets des commandes à l'avance » (60 minutes proposées, back-office), une seule fois (`premiers_tickets`). « Imprimer maintenant » avant. Jour affiché à côté de l'heure promise |
| SS-14 | restant, pas petit | Le numéro figure dans la description du paiement Stripe, créée avant le paiement. Le donner au paiement touche la création de commande, le webhook et la page de suivi (parcours client). Proposition moins coûteuse : expliquer à l'équipe qu'un numéro sauté est un paiement abandonné |
| SS-13, SS-21, SS-22 | restants, sans code | Temps des gestes (Francfort), recette avec une imprimante branchée, redéploiement pendant la recette : essais R-09, R-03 et R-10 |

Légende : **vérifié** = reproduit par un script ou un test ; **lu** = établi par lecture du code, sans reproduction ; **supposé** = hypothèse à confirmer sur la vraie infrastructure.

## Les 10 constats les plus importants

| # | Constat | Gravité | Preuve |
|---|---|---|---|
| SS-01 | Après une « Pause 30 min » ou « Pause 1 h » arrivée à son terme, la pause automatique (tablette muette) ne se déclenche plus jamais | bloquant | vérifié |
| SS-02 | La capacité par créneau n'existe pas : 8 commandes acceptées pour le même créneau de 23h00, réglages 3 et 4 en base jamais lus | bloquant | vérifié |
| SS-03 | Une commande annulée après acceptation : rien n'est imprimé pour prévenir la cuisine. Ses tickets encore en file sortent quand même | bloquant | vérifié |
| SS-04 | Refus d'une commande payée quand Stripe ne répond pas : le client n'est prévenu de rien. La commande disparaît de la tablette à minuit avec l'argent encaissé | bloquant | vérifié |
| SS-05 | Commande à l'avance numérotée au jour où elle est passée : deux « N° 001 » le même samedi soir | bloquant | vérifié |
| SS-06 | Accepter sur une tablette et refuser sur l'autre au même instant : les deux réussissent, tickets imprimés puis commande remboursée | important | vérifié |
| SS-07 | Confirmation d'impression perdue : le même ticket ressort 2 minutes plus tard, sans la mention « RÉIMPRESSION » | important | vérifié |
| SS-08 | Une commande payée pendant la pause, après une rupture ou après l'heure limite arrive quand même sur la tablette | important | vérifié |
| SS-09 | Alerte « commande pas acceptée » envoyée hors service (10h05 pour une commande du soir, 0h01 pour une commande du lendemain) | important | vérifié |
| SS-10 | Le signe de vie vient de n'importe quel appareil ouvert sur `/tablette` : le téléphone du gérant à la maison empêche la pause automatique | important | lu |

## Ce qui marche bien (vérifié)

- **Aucune commande perdue ni en double.** 58 tentatives pendant le service simulé, 53 commandes enregistrées (les 5 autres refusées à juste titre : 3 pour un plat épuisé, 2 pendant une pause). Les 53 sont apparues une fois chacune sur la tablette. 65 tâches d'impression, 66 tickets sortis (le seul doublon est SS-07), aucun ticket manquant.
- **Numéros sans doublon sous concurrence le même jour.** Cinq commandes envoyées à la même seconde, deux fois : numéros consécutifs, aucun doublon (le compteur du jour est verrouillé en base).
- **Deux tablettes qui acceptent la même commande au même instant :** une seule acceptation passe (3 essais sur 3), l'autre écran affiche « Cette commande a déjà changé. La liste se met à jour. » Un seul jeu de tickets.
- **Routage pizza et cuisine juste**, avec les options écrites comme prévu : `CHOIX Penne`, `+ Ananas`, `+ Anchois`, `SANS Origan`, la note « sans œufs, très chaud ». Les tickets PNG sortent avec les accents et le « œ » (police DejaVu). Le texte de secours ASCII donne « oeufs ».
- **Imprimante cuisine hors ligne pendant 10 commandes** (190 secondes) : la tablette l'affiche, les 10 tickets attendent en base et sortent tous à son retour, dans l'ordre des acceptations, sans doublon ni perte.
- **Rupture en plein service :** posée depuis la tablette, elle bloque la commande suivante 5 secondes plus tard (« Lasagne de bœuf : Épuisé pour aujourd'hui. »). Elle se lève seule à minuit, heure de Genève.
- **Pause manuelle :** une commande tentée 5 secondes après la pause est refusée avec l'heure de reprise. La pause se lève seule à son heure.
- **Pause automatique quand la valeur est « reprise » :** juste après « Reprendre », tablettes coupées : les commandes sont refusées « en pause » entre la 3e et la 4e minute, la tablette affiche « Pause automatique » à son retour et l'alerte part (écrite dans les journaux, pas de Resend en local). « Reprendre les commandes » relance tout.
- **Minuit :** le compteur repart à 1 à 0h00 heure de Genève (test à 23:59:50 puis 00:00:10).
- **Heure d'été et d'hiver :** l'heure inexistante du 29.3 est refusée, les créneaux d'un mardi commandés le samedi d'avant le changement d'heure tombent juste, le dimanche du changement est fermé.
- **Remboursement réessayé :** une fois Stripe revenu, le bouton « Rembourser » rembourse et le client reçoit l'e-mail.
- **Redémarrage du serveur :** rien d'indispensable ne vit dans la mémoire du processus (lu, voir SS-22).
- **Temps de réponse locaux** sous charge : relecture de la file 12 ms en médiane (20 ms au 95e centile, 664 relectures), accepter 8 ms, changer de statut 5 ms, rendu d'un ticket PNG 14 ms (65 ms au premier, chargement du moteur), commande 8 ms (600 ms pour une livraison, à cause du registre fédéral). Une commande payée apparaît sur la tablette en 2,7 s en médiane, 4,8 s au plus (relecture toutes les 5 s sans Realtime). Ces temps ne valent que pour la base embarquée (voir SS-13).
- **Coupure réseau de la tablette (Chrome, `tablette-reseau.mjs`) :** bandeau « Pas de connexion depuis… » ; « Accepter » hors ligne affiche « Pas de connexion. Vérifiez le réseau et réessayez. » et le bouton redevient utilisable ; au retour du réseau, le bandeau disparaît à la relecture suivante et l'acceptation passe (captures dans `docs/audits/samedi-soir-captures/`).
- **Réimpression :** un nouveau ticket marqué « RÉIMPRESSION » à chaque poste.

## Constats

### SS-01 Pause automatique désactivée après une pause datée

- **Gravité :** bloquant avant lancement. **Effort :** petit.
- **Où :** `supabase/migrations/20261111090000_impression.sql:304` (`pause_automatique`), `src/app/api/tablette/reglages/route.ts:19`, `src/lib/service.ts:193`, `src/components/tablette/Reglages.tsx:52`.
- **Reproduire :** sur la tablette, « Pause 30 min ». Attendre la fin de la pause. Couper la tablette 3 minutes pendant le service.
- **Attendu :** pause automatique des commandes en ligne et e-mail d'alerte.
- **Observé (vérifié) :** dans le service simulé, pause de 15 minutes posée à 520 s, finie à 1420 s. Tablettes coupées de 1460 à 1760 s : les commandes d'essai passent encore après 1, 2, 3, 4 et 5 minutes, aucune pause, aucune alerte. Témoin juste après « Reprendre » : pause automatique entre la 3e et la 4e minute. Test `base.audit.test.ts` « après une pause datée arrivée à son terme… » : `pause_automatique()` renvoie faux et la valeur reste `"2026-11-14T18:30:00.000Z"`.
- **Cause :** une pause datée écrit sa date de fin dans `reglages.pause_jusqu_a`. À l'expiration, rien ne remet la valeur à `null` : le site la considère finie par calcul (`pauseEnCours` compare la date à l'heure réelle). Or `pause_automatique()` ne s'active que si la valeur vaut exactement `null`. Et l'écran des réglages n'affiche plus « Reprendre les commandes » (la pause est finie à ses yeux), donc personne ne peut la remettre à `null` sans relancer une pause puis reprendre. Après la première pause datée de la saison, la protection « tablette muette » est coupée pour toujours.
- **Correction proposée :** dans `pause_automatique()`, ne refuser que si une pause est réellement en cours (`valeur = '"sans-fin"'` ou date future), sinon écrire `"sans-fin"`. Ajouter le test.

### SS-02 Capacité par créneau absente

- **Gravité :** bloquant avant lancement. **Effort :** moyen.
- **Où :** `supabase/migrations/20261106120000_zones_horaires.sql:107` (réglages créés), `src/lib/service.ts:246` (`quandPossible`), `src/app/api/commandes/route.ts:74`. `docs/PROMPT.md` §4 et §6 demandent une « capacité par créneau réglable ».
- **Reproduire :** passer 8 commandes pour le même créneau.
- **Attendu :** 3 livraisons et 4 retraits au plus par créneau (valeurs proposées en base), puis le créneau disparaît pour le client.
- **Observé (vérifié) :** les 8 commandes pour 23h00 (4 livraisons, 4 retraits) sont enregistrées puis acceptées sur la tablette pour 23h00. Aucune fonction SQL ni aucun fichier de `src/` ne lit `capacite_livraisons_par_creneau` ni `capacite_retraits_par_creneau`. Les « dès que possible » ne sont pas comptés non plus.
- **Conséquence un samedi :** les commandes à l'avance s'empilent sur 19h30 et 20h00 sans limite. La seule soupape est la pause manuelle, ou le refus avec remboursement (frais Stripe perdus, client fâché).
- **Correction proposée :** compter par créneau les commandes non refusées ni annulées (dans `creneaux()` côté client pour griser ; dans `creer_commande` sous verrou pour trancher), en comptant les « dès que possible » au créneau de leur heure proposée. Afficher la charge par créneau sur la tablette.

### SS-03 Annulation après acceptation non transmise en cuisine

- **Gravité :** bloquant avant lancement. **Effort :** petit.
- **Où :** `src/lib/tablette.ts:128` (refus), `supabase/migrations/20261109090000_tablette.sql:243` (`refusee` permis depuis `acceptee` et `en_preparation`), `supabase/migrations/20261111090000_impression.sql:87`.
- **Reproduire :** imprimante cuisine débranchée, accepter une commande, puis « Annuler la commande ». Rebrancher l'imprimante.
- **Attendu :** un ticket « ANNULÉE » à chaque poste qui a déjà reçu la commande. Aucun ticket en attente de cette commande qui sorte ensuite.
- **Observé (vérifié) :** commande n° 22 acceptée à 273 s, annulée à 288 s (« Commande refusée. Le client est prévenu. »). Son ticket pizza était déjà sorti, rien n'est venu l'annuler ; il est même ressorti à 394 s (SS-07). Son ticket cuisine, en file, est sorti au retour de l'imprimante à 431 s comme une commande normale. Bilan : trois tickets en cuisine pour une commande annulée. Test `base.audit.test.ts` « la commande annulée après acceptation garde ses tickets en file ».
- **Cause :** l'impression n'est créée qu'à l'acceptation (`imprimerCommande`). Le refus ne touche pas `taches_impression`.
- **Correction proposée :** au passage à `refusee` depuis `acceptee` ou `en_preparation`, passer les tâches `en_attente` de la commande en `annulee` et créer un ticket court « ANNULÉE N° … » pour chaque poste dont le ticket est déjà sorti.

### SS-04 Remboursement raté : client sans nouvelles, refus perdu à minuit

- **Gravité :** bloquant avant lancement. **Effort :** moyen.
- **Où :** `src/lib/tablette.ts:131`, `src/lib/commandes.ts:77`, `supabase/migrations/20261109090000_tablette.sql:220` (`file_tablette`), `src/components/tablette/Tablette.tsx:560`.
- **Reproduire :** test `remboursement.audit.test.ts` (Stripe en panne simulée), puis `base.audit.test.ts` « un refus dont le remboursement a raté disparaît de la tablette après minuit ».
- **Attendu :** le client apprend que sa commande est refusée et que le remboursement suit. Le restaurant garde la commande sous les yeux tant que l'argent n'est pas rendu et reçoit une alerte.
- **Observé (vérifié) :**
  - la tablette dit « Commande refusée, mais le remboursement n'est pas passé. Réessayez. » ; la commande est `refusee` et reste `paye` ;
  - aucun e-mail au client : le courriel de remboursement n'est envoyé qu'après un remboursement réussi ; le courriel de refus n'est envoyé qu'aux commandes non payées. Le client a payé, ne reçoit rien. Son suivi affiche « refusée » ;
  - la commande n'est visible que dans l'onglet « Terminées », avec le bouton « Rembourser ». Le lendemain à 0h00, `file_tablette` ne garde que les refus du jour : la commande disparaît, toujours payée. Aucune alerte, aucun écran du back-office ne la montre.
- **Correction proposée :** envoyer au client un e-mail « refusée, remboursement en cours » dès le refus ; garder dans la file toute commande `refusee` et `paye`, quel que soit le jour, en tête de liste ; alerte `ALERTE_EMAIL` ; relance automatique du remboursement par la surveillance.

### SS-05 Deux « N° 001 » le même soir

- **Gravité :** bloquant avant lancement. **Effort :** petit.
- **Où :** `supabase/migrations/20261107090000_commandes.sql:107` et `:116` (`jour` = jour de création).
- **Reproduire :** test `base.audit.test.ts` « une commande à l'avance prend le numéro du jour où elle est passée ».
- **Attendu :** un numéro unique parmi les commandes servies le même jour.
- **Observé (vérifié) :** commande passée mercredi à 10h pour samedi 20h30 : n° 1 (compteur du mercredi). Première commande du samedi : n° 1. La tablette du samedi affiche deux commandes n° 1, les deux tickets portent « N° 001 ». Seule la ligne de date du ticket les distingue.
- **Correction proposée :** numéroter au jour de service (`quand_date` pour un créneau, jour de création pour « dès que possible »). Le numéro peut aussi être attribué au paiement plutôt qu'à la création (voir SS-14).

### SS-06 Accepter et refuser au même instant

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/app/api/tablette/action/route.ts:15`, `supabase/migrations/20261109090000_tablette.sql:243`.
- **Reproduire :** tablette A « Accepter », tablette B « Refuser » sur la même commande payée, au même instant.
- **Attendu :** une des deux actions passe, l'autre écran dit que la commande a changé.
- **Observé (vérifié, 2 fois sur 2 dans le service simulé, plus le test) :** les deux répondent 200. L'acceptation passe, les tickets pizza et cuisine sortent, puis le refus passe (`acceptee → refusee` est permis) avec remboursement. A voit « acceptée », B voit « Commande refusée et remboursée. » La cuisine prépare une commande remboursée (SS-03).
- **Cause :** le refus n'envoie pas l'état que la personne avait sous les yeux. Le serveur ne peut pas distinguer « refuser une nouvelle commande » d'« annuler une commande acceptée ».
- **Correction proposée :** envoyer l'état attendu (`de: "nouvelle"`) avec chaque action et le vérifier dans `changer_statut`. Garder « Annuler la commande » comme action distincte, avec confirmation.

### SS-07 Ticket en double après une confirmation perdue

- **Gravité :** important. **Effort :** petit.
- **Où :** `supabase/migrations/20261111090000_impression.sql:84`.
- **Reproduire :** l'imprimante télécharge le ticket (GET) mais la confirmation (DELETE) ne part pas (coupure réseau, imprimante éteinte juste après la coupe).
- **Attendu :** au pire un second ticket marqué « RÉIMPRESSION », au mieux une confirmation tardive acceptée.
- **Observé (vérifié) :** ticket pizza n° 22 imprimé à 273,4 s sans confirmation, ressorti identique à 393,9 s (120,5 s plus tard), sans mention. Entre les deux, les tickets suivants sont sortis normalement : ordre modifié. Test `base.audit.test.ts` « confirmation perdue ».
- **Correction proposée :** ajouter « DOUBLE POSSIBLE » ou « RÉIMPRESSION » sur un ticket renvoyé après expiration ; afficher l'événement sur la tablette.

### SS-08 Paiement accepté après la pause, la rupture ou l'heure limite

- **Gravité :** important. **Effort :** moyen.
- **Où :** `src/app/api/commandes/route.ts:72` (contrôles à la création seulement), `supabase/migrations/20261107090000_commandes.sql:148` (`appliquer_paiement`), `src/lib/paiement/passerelle.ts:68` (session de 30 minutes).
- **Reproduire :** commencer un paiement en ligne, puis poser une rupture ou une pause, puis payer.
- **Attendu :** le client est arrêté avant de payer, ou la commande est signalée sur la tablette.
- **Observé (vérifié) :** commande C19 (lasagne) créée à 190 s, rupture à 200 s, payée à 230 s : elle arrive en « À accepter » sans aucune mention de la rupture. Test SQL : commande payée pendant une pause « sans fin » : `nouvelle`. Même chose pour une commande « dès que possible » créée à 21h29 et payée à 21h45, ou une zone fermée entre-temps (lu).
- **Correction proposée :** au paiement confirmé, recontrôler pause, ruptures et créneau. En cas d'écart, marquer la commande sur la tablette (« payée pendant la pause », « contient un plat épuisé ») au lieu de la laisser passer en silence. Réduire l'écart en expirant la session Stripe dès qu'une pause est posée.

### SS-09 Alertes « pas acceptée » hors service

- **Gravité :** important. **Effort :** petit.
- **Où :** `supabase/migrations/20261111090000_impression.sql:285` (`commandes_en_retard`).
- **Reproduire :** tests `base.audit.test.ts`, bloc « alerte de commande non acceptée ».
- **Observé (vérifié) :**
  - commande passée samedi à 10h pour 21h : alerte à 10h06 (le délai compte depuis la création, quel que soit l'horaire) ;
  - commande passée vendredi pour samedi : alerte samedi à 0h01 ;
  - client qui reste 7 minutes sur la page de paiement TWINT : alerte dès l'arrivée sur la tablette, l'écran dit « Attend depuis 7 min » ;
  - l'alerte est marquée envoyée avant l'envoi : un e-mail qui échoue n'est jamais renvoyé (lu, `src/lib/surveillance.ts:50`).
- **Correction proposée :** compter l'attente depuis `paye_le` (ou la création pour le comptoir), seulement pendant un service ouvert ; pour une commande à l'avance, à partir de l'ouverture du service concerné.

### SS-10 Signe de vie sans identité d'appareil

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/app/api/tablette/file/route.ts:13`, `supabase/migrations/20261111100000_correctif_signe_tablette.sql`.
- **Reproduire :** éteindre la tablette de la cuisine pendant le service, garder `/tablette` ouverte sur un autre appareil connecté.
- **Attendu :** pause automatique après 3 minutes. **Observé :** aucune pause tant que l'autre appareil relit la file.
- **Observé (lu, plus test de la table) :** `surveillance_etat` a une seule colonne `tablette_vue_le`. N'importe quelle session du personnel qui ouvre `/tablette` (le téléphone de Jérémy, une deuxième tablette en salle) écrit le signe de vie. La tablette de la cuisine peut être éteinte depuis une heure sans pause automatique.
- **Correction proposée :** un signe de vie par appareil (identifiant posé par « Démarrer le service ») et un réglage « tablette de référence », ou au minimum n'écrire le signe de vie qu'après « Démarrer le service ».

### SS-11 Commande acceptée à l'avance : ticket imprimé tout de suite

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/lib/tablette.ts:124`, `src/components/tablette/Tablette.tsx:449` (bouton « Accepter » aussi dans l'onglet « À l'avance »).
- **Reproduire :** onglet « À l'avance », accepter une commande d'un autre jour.
- **Attendu :** ticket le jour du service. **Observé :** ticket tout de suite.
- **Observé (lu) :** accepter mercredi une commande de samedi imprime ses tickets mercredi. Le ticket porte bien « Samedi, 14.11.2026 » et « POUR 19:30 » (vérifié, `heures.audit.test.ts`), mais il sort trois jours avant, sur le rouleau du jour.
- **Correction proposée :** pour une commande d'un autre jour, accepter sans imprimer, puis imprimer à l'ouverture du service du jour (ou X minutes avant l'heure), avec l'option « imprimer maintenant ».

### SS-12 Acceptation sans ticket : aucun bouton pour réimprimer

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/lib/tablette.ts:124`, `src/components/tablette/Tablette.tsx:534`.
- **Reproduire :** faire échouer `creer_taches_impression` pendant une acceptation (coupure de la base).
- **Attendu :** la tablette signale le ticket manquant et propose de réimprimer. **Observé :** rien.
- **Observé (lu) :** si la création des tickets échoue après l'acceptation (base lente, coupure), l'erreur part dans les journaux seulement. La commande est acceptée, sans tâche d'impression. Or le bloc « Ticket / Réimprimer » ne s'affiche que s'il existe au moins une tâche : la commande n'a ni ticket, ni bouton, ni alerte.
- **Correction proposée :** afficher toujours « Réimprimer » sur une commande acceptée. Afficher « Ticket non créé » quand elle n'a aucune tâche.

### SS-13 Temps des gestes de la tablette sur la vraie infrastructure

- **Gravité :** important. **Effort :** sans code (région Francfort, déjà dans `docs/mise-en-ligne.md`), moyen pour paralléliser.
- **Où :** `src/lib/tablette.ts:112` (`agir`).
- **Mesuré en local (vérifié) :** médianes sur la base embarquée : accepter 8 ms, refuser 7 ms, statut 5 ms, relecture de la file 12 ms. Cinq commandes à la même seconde : 9, 11, 14, 18 et 21 ms, traitées l'une après l'autre.
- **Calculé pour la production (non mesuré) :** « Accepter » enchaîne en série 6 appels à la base (session du personnel, lecture de la commande, changement de statut, relecture pour le ticket, création des tickets, copie du courriel), plus l'envoi Resend et le signal Realtime (jusqu'à 1,5 s d'attente). Puis la tablette relit sa file : 3 allers-retours de plus. Avec la mesure de `docs/performance.md` (350 ms par appel depuis l'Ohio) : environ 2,1 s de base, plus Resend, soit **2,5 à 4 s** avant que la liste se mette à jour. Depuis Francfort (30 ms) : environ **0,5 à 1 s**. `docs/performance.md` annonce 0,7 à 1 s aujourd'hui : c'est sous-estimé. Le refus d'une commande payée ajoute l'appel à Stripe.
- **Correction proposée :** Francfort avant le lancement ; envoyer courriel et signal après la réponse (sans attendre) ; faire la relecture pour le ticket dans `changer_statut`.

### SS-14 Trous dans les numéros

- **Gravité :** confort. **Effort :** petit (avec SS-05).
- **Où :** `src/app/api/commandes/route.ts:80` (numéro attribué avant le paiement).
- **Reproduire :** test `base.audit.test.ts` « un paiement en ligne abandonné garde son numéro ».
- **Attendu :** numéros visibles consécutifs.
- **Observé (vérifié) :** un paiement abandonné ou expiré garde son numéro : la tablette affiche 1, 2, 5. Le personnel peut croire à une commande perdue.
- **Correction proposée :** numéro attribué à la confirmation du paiement (ou à la création pour le comptoir).

### SS-15 Second changement d'heure : e-mail probablement jamais envoyé

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/lib/courriel/envoi.ts:30`, `src/lib/courriel/modeles.ts:163`.
- **Reproduire :** changer deux fois l'heure d'une commande acceptée, Resend branché.
- **Attendu :** deux e-mails.
- **Observé (lu, effet supposé) :** la clé d'idempotence Resend est `<commande>-<sujet>`. Le sujet « Commande N, nouvelle heure » est le même à chaque changement. D'après la règle d'idempotence de Resend (clé réutilisée dans les 24 heures), le deuxième changement d'heure n'enverrait rien, ou serait refusé et seulement noté dans les journaux. Le client garde l'ancienne heure.
- **Correction proposée :** mettre l'heure (ou un compteur) dans la clé. À rejouer avec Resend (R-07).

### SS-16 Double appui sur « Rembourser »

- **Gravité :** confort. **Effort :** petit.
- **Où :** `src/lib/tablette.ts:144`. **Reproduire :** test `remboursement.audit.test.ts` « deux appuis simultanés ».
- **Attendu :** les deux écrans disent « remboursée ».
- **Observé (vérifié) :** deux appuis simultanés font deux appels à Stripe (même clé d'idempotence, donc un seul remboursement) ; un écran dit « Remboursement fait », l'autre « Le remboursement n'est pas passé. Vérifiez dans Stripe ou appelez Jérémy. »
- **Correction proposée :** relire l'état après coup et répondre « déjà remboursée ».

### SS-17 Réimprimer pendant une panne d'imprimante

- **Gravité :** confort. **Effort :** petit.
- **Où :** `src/lib/impression/service.ts:10`. **Reproduire :** test `base.audit.test.ts` « Réimprimer pendant que l'imprimante est hors ligne ».
- **Attendu :** un seul ticket à son retour.
- **Observé (vérifié) :** « Réimprimer » pendant que l'imprimante est hors ligne ajoute un second ticket en file : deux tickets de la même commande sortent à son retour.
- **Correction proposée :** si une tâche du même poste est encore en file, ne pas en créer une seconde.

### SS-18 Son après rechargement ou mise en veille

- **Gravité :** important. **Effort :** petit.
- **Où :** `src/components/tablette/Tablette.tsx:149` et `:166`.
- **Reproduire :** `tablette-reseau.mjs` (rechargement) ; sur iPad, verrouiller l'écran 5 minutes puis le rallumer et passer une commande.
- **Attendu :** la file reste visible et le son revient, ou un rappel impossible à manquer.
- **Observé :** (vérifié, Chrome) après rechargement de la page, un écran gris « Démarrer le service » recouvre toute la file (capture 4) : tant que personne n'y touche, aucune commande n'est visible ni sonnée. Le son n'est rétabli qu'après un appui sur « Démarrer le service » (règle des navigateurs). Au retour de veille, le code redemande le maintien de l'écran mais ne relance pas le son (`AudioContext.resume()` absent) : sur iPad, un contexte audio suspendu par la veille peut rester muet (supposé, à vérifier sur la tablette).
- **Correction proposée :** relancer `audio.current.resume()` au retour de visibilité ; bandeau rouge plein écran « Son coupé, touchez pour l'activer » tant que le son n'est pas actif pendant un service.

### SS-19 Tickets « sans imprimante » jamais rattrapés

- **Gravité :** confort. **Effort :** petit.
- **Où :** `supabase/migrations/20261111090000_impression.sql:159`.
- **Reproduire :** désactiver l'imprimante pizza, accepter une commande, réactiver l'imprimante.
- **Attendu :** le ticket sort à la réactivation. **Observé :** il reste « pas d'imprimante ».
- **Correction proposée :** à l'ajout ou à la réactivation d'une imprimante, lui donner les tâches `sans_imprimante` du jour, ou le proposer sur la tablette.
- **Observé (lu) :** une commande acceptée alors qu'aucune imprimante du poste n'est active a ses tâches en `sans_imprimante`. Brancher ou réactiver l'imprimante ensuite ne les réattribue pas : il faut penser à « Réimprimer » commande par commande.

### SS-20 Double clic sur « Payer » contre le vrai Postgres

- **Gravité :** important. **Effort :** petit.
- **Où :** `supabase/migrations/20261107090000_commandes.sql:111`.
- **Observé (lu, supposé sur Supabase) :** la recherche de la clé d'idempotence se fait avant l'insertion, sans verrou. Sur la base embarquée, les requêtes passent l'une après l'autre et le second clic retrouve la commande. Sur Postgres, deux requêtes simultanées passent la recherche ensemble ; la seconde échoue sur la contrainte d'unicité et renvoie une erreur 500 au navigateur au lieu de la commande existante. À rejouer (R-01).
- **Correction proposée :** `insert … on conflict (cle_idempotence) do nothing` puis relecture, ou verrou consultatif sur la clé.

### SS-21 Surveillance des préversions

- **Gravité :** important pour la recette. **Effort :** sans code.
- **Où :** `netlify/functions/surveillance.mts`, `src/lib/surveillance.ts:39`.
- **Reproduire :** sur une préversion sans imprimante branchée, éteindre la tablette pendant un service.
- **Attendu :** pause automatique après 3 minutes. **Observé (lu) :** rien ne lance la surveillance.
- **Correction proposée :** faire la recette avec une imprimante branchée, ou ajouter un déclencheur externe sur les préversions.
- **Observé (lu) :** la fonction planifiée ne tourne qu'en production. Sur une préversion, la surveillance n'est lancée que par une imprimante ou une tablette qui interroge le site. Tablette éteinte et aucune imprimante branchée : rien ne déclenche la pause automatique ni l'alerte. La recette « tablette éteinte trois minutes » doit se faire avec une imprimante branchée, ou sur la production.

### SS-22 Redémarrage du serveur en plein service

- **Gravité :** sans objet en production. **Effort :** aucun.
- **Observé (lu) :** l'état gardé en mémoire se limite à des caches et à deux limiteurs (`dernierSigne` 30 s, `dernierTour` 60 s), qui repartent à zéro sans dommage : commandes, file d'impression, pause et signe de vie sont en base. Une fonction Netlify qui redémarre ou une deuxième instance ne perd rien.
- **Limite de l'essai :** en local, la base embarquée vit dans la mémoire du processus. Redémarrer l'instance locale efface toutes les commandes : c'est propre à la base embarquée, pas au site. Le vrai essai (redéployer pendant un service fictif) est dans la liste de recette (R-10).

## Ce que la base embarquée ne reproduit pas

La base embarquée rejoue les mêmes migrations, mais elle diffère de Supabase sur ces points. Chacun peut cacher un bug du type « UPDATE sans WHERE refusé » déjà rencontré.

| Écart | Effet sur l'audit | Où regarder |
|---|---|---|
| Une seule connexion : les requêtes passent l'une après l'autre | Aucune vraie concurrence en base. Les courses observées ici viennent de l'entrelacement côté serveur, pas des verrous de Postgres | SS-20, `changer_statut`, `creer_commande`, `passage_imprimante` |
| Le serveur local appelle les fonctions en super-utilisateur, Supabase en `service_role` via PostgREST | Les droits (`grant`, `revoke`) et la sécurité par ligne ne sont pas exercés par les parcours locaux | toutes les fonctions appelées par `fonctionSql` |
| Pas d'extension `safeupdate` | Un UPDATE ou DELETE sans WHERE passe en local et échoue sur Supabase. `tests/unit/migrations.test.ts` le vérifie sur le texte des fonctions (passe aujourd'hui) | toute nouvelle fonction |
| PostgREST : conversion des arguments et des retours (`timestamptz`, `jsonb`, `null`, fonctions qui renvoient une table), cache du schéma après une migration | Formes de réponse différentes de la base embarquée (déjà traitées dans `src/lib/db/serveur.ts`) | `creer_commande`, `appliquer_paiement` |
| Pas de délai maximal par requête ni de limite de connexions | Une requête lente ne casse rien en local | file de la tablette, surveillance |
| Pas de Supabase Realtime | La tablette relit toutes les 5 s en local, au lieu de 15 s avec le signal | `Tablette.tsx:117`, `signalerTablette` |
| Temps de réponse de quelques millisecondes | Les temps mesurés ici ne disent rien de l'Ohio ni de Francfort | SS-13 |
| Pas de Netlify : une seule instance, pas de démarrage à froid, pas de cache partagé ni de fonction planifiée | Purge du cache (pause, rupture), fonction planifiée, délai maximal des fonctions non testés | SS-21 |
| Doublures Stripe et Resend | Pas d'échec réel de remboursement, pas de webhook en retard ni d'idempotence Resend | SS-04, SS-15 |
| Les vues SQL figent `now()` à leur création (vu avec l'horloge simulée) | Sans effet sur le site, à savoir pour écrire des tests | `carte_publique` |

## À rejouer sur la vraie infrastructure pendant la recette

À ajouter à la phase 3 de `docs/mise-en-ligne.md`. Sur la préversion finale, Stripe en test, avec la vraie tablette et au moins une vraie imprimante.

| # | Essai | Attendu | Lien |
|---|---|---|---|
| R-01 | Double clic rapide sur « Payer » (ou deux onglets avec le même panier) | Une seule commande, pas d'erreur 500 | SS-20 |
| R-02 | Deux tablettes : accepter en même temps, puis accepter sur l'une et refuser sur l'autre | Une seule action passe | SS-06 |
| R-03 | « Pause 30 min » (minimum proposé : 15 min par la route, 30 min à l'écran), attendre la fin, puis éteindre la tablette 4 minutes pendant le service, imprimante branchée | Pause automatique et alerte | SS-01, SS-21 |
| R-04 | Tablette en veille écran éteint, puis rallumée ; onglet en arrière-plan 10 minutes ; tablette rechargée | Son des nouvelles commandes, signe de vie, file à jour | SS-18 |
| R-05 | Wi-Fi de la tablette coupé 5 minutes pendant le service | Bandeau « Pas de connexion », pause automatique après 3 minutes, bandeau de pause au retour | SS-10 |
| R-06 | Refus d'une commande TWINT et d'une commande par carte, puis lecture dans Stripe (remboursement « succeeded », pas « pending ») | Remboursement réel, e-mail reçu | SS-04 |
| R-07 | Changer deux fois l'heure d'une commande acceptée | Deux e-mails reçus avec chacun la bonne heure | SS-15 |
| R-08 | Débrancher l'imprimante pendant 5 commandes, puis la rebrancher ; couper le réseau juste après un ticket ; papier vide ; capot ouvert | Tous les tickets sortent, l'état s'affiche, temps de vidage de la file noté | SS-07 |
| R-09 | Mesurer « Accepter », « Refuser », « Prête » sur la tablette (chronomètre ou `Server-Timing`) | Moins de 1 s après Francfort | SS-13 |
| R-10 | Redéploiement Netlify pendant le service fictif | Aucune commande perdue, tablette et imprimantes reprennent seules | SS-22 |
| R-11 | Pause posée depuis la tablette, puis commande tentée tout de suite depuis un autre appareil | Refusée en quelques secondes (cache Netlify vidé) | `rafraichirCaches` |
| R-12 | Le signal Realtime passe (tablette à 15 s) et le canal public est autorisé dans les réglages Realtime du projet | Relecture à 15 s, pas 5 s | `docs/performance.md` |
| R-13 | Commande au statut « Prête », puis vérifier la commande « Moi Moi » et les traces de test avant la bascule | Base nettoyée | `docs/mise-en-ligne.md` phase 4 |
| R-14 | Commande pour le lendemain 19h30, acceptée la veille, imprimante branchée. Le lendemain, noter l'heure de sortie du ticket, tablette éteinte | Rien à l'acceptation ; tickets entre 18h30 et 18h32, heure d'acceptation de la veille sur le ticket | SS-11 |
| R-15 | Même essai, imprimante éteinte de 18h20 à 18h45 | Ticket à la remise en route, une seule fois | SS-11, SS-07 |
| R-16 | Commande à l'avance acceptée, puis heure changée sur la tablette ; une autre annulée avant son heure d'impression | Ticket à la nouvelle heure, avec la nouvelle heure ; rien pour l'annulée | SS-11, SS-03 |
| R-17 | Redéploiement Netlify (ou fonction planifiée arrêtée) entre l'acceptation et l'heure d'impression, puis vérifier que la fonction planifiée `surveillance` tourne sur la production | Tickets à l'heure, pas en double | SS-11, SS-22 |
| R-18 | Deux commandes, une à l'avance et une « dès que possible », avec le même numéro (jour de service différent) | Jamais côte à côte dans « En cours » avant le jour J | SS-05, SS-11 |

## Méthode et limites

- Horaires du jeudi modifiés sur l'instance locale (00h15 à 23h50) pour que l'heure réelle du test (vers 2h du matin à Genève) tombe pendant un service.
- Fausses imprimantes interrogées toutes les 2 secondes. Elles réinterrogent tout de suite après un ticket. Une vraie mC-Print3 réglée à 10 secondes donne un ticket par interrogation : si elle n'interroge pas aussitôt après un ticket (non vérifié), une file de 10 tickets met jusqu'à 100 secondes à se vider.
- Pas de Realtime : la tablette simulée relit toutes les 5 secondes.
- Chiffres bruts du service simulé : `docs/audits/samedi-soir-resultats.json`.
