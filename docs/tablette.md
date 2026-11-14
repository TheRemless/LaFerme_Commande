# Tablette du restaurant (lot 7a)

Adresse : `/tablette` (non indexée). Réservée au personnel, connexion distincte des comptes clients.

## Connexion du personnel

- E-mail et code à 8 chiffres (6 pour les clients), sinon mêmes règles que les clients (`docs/comptes.md`) : usage unique, 10 minutes, 5 essais, limites par e-mail et par IP, 15 codes faux par jour et par adresse.
- Seules les adresses de la table `personnel` (actives) reçoivent un code. La page répond la même chose pour une adresse inconnue, sans envoyer de courriel, et après la même durée (1,5 seconde au moins, audit de sécurité S11). À la vérification, le délai entre deux codes faux (1, 2, 4 puis 8 secondes) s'applique aussi sans code en base, pour que la réponse ne dise pas si l'adresse est de l'équipe.
- Au 15e code faux en 24 heures sur une adresse de l'équipe, la connexion par code est bloquée jusqu'au lendemain à la même heure. Le membre et le restaurant (`ALERTE_EMAIL`) reçoivent un courriel, une seule fois. Les appareils déjà connectés le restent.
- Session de 60 jours dans un cookie à part (`__Host-laferme-personnel`, HttpOnly, Secure, SameSite=Strict). Un membre désactivé perd l'accès tout de suite.
- Rôles : `service` (la tablette), `gerant` (la tablette, puis le back-office au lot 7b) et `livreur` (seulement ses livraisons, page `/livreur`, voir `docs/livreurs.md`). Un livreur n'ouvre ni la tablette ni le back-office.

Ajouter, retirer ou changer l'accès de quelqu'un : back-office, rubrique « Équipe » (depuis le 14.11.2026). Seul le tout premier gérant se crée dans l'éditeur SQL de Supabase, une fois :

```sql
insert into personnel (email, nom, role) values ('prenom@exemple.ch', 'Prénom', 'gerant');
```

## Ce que fait la tablette

- « Démarrer le service » active le son et garde l'écran allumé. Sans ce geste, la page le dit.
- File des commandes à accepter, son répété toutes les 4 secondes et bandeau jaune pâle tant qu'une commande du jour attend.
- Accepter : heure proposée (celle du client, ou au plus tôt), réglable de 5 et 15 minutes. Le client reçoit un e-mail avec l'heure.
- Refuser avec un motif (trois motifs prêts ou un texte libre). Payée en ligne : remboursement total automatique, sinon e-mail « rien n'a été débité ». Un remboursement raté reste visible avec un bouton pour réessayer.
- Statuts en un appui : en préparation, prête au comptoir ou partie en livraison (e-mail au client), retirée ou livrée. Encaissée pour le comptoir. Changer l'heure (e-mail au client).
- Onglet « À l'avance » : commandes à accepter pour un autre jour, et commandes acceptées pour plus tard dont les tickets ne sont pas encore sortis (« Tickets prévus le vendredi 13 novembre à 18h30 », bouton « Imprimer maintenant »). À l'heure d'impression, elles passent dans « En cours ». Le jour s'affiche à côté de l'heure promise dès qu'il n'est pas aujourd'hui.
- Réglages : pause des commandes en ligne (30 min, 1 h, jusqu'à reprise), livraison fermée, retard du soir, plats épuisés pour la journée (ils reviennent seuls le lendemain).
- Mise à jour : relecture toutes les 15 secondes pendant le service, toutes les 60 secondes hors service (toutes les 5 secondes si le signal ne passe pas). Le signal Supabase Realtime (message vide sur le canal `tablette`, aucune donnée) déclenche une relecture immédiate. Perte de connexion : bandeau avec l'heure du dernier contact.
- Chaque changement de statut est tracé dans `evenements_commande` avec son auteur (`tablette:Prénom`).

## Rush (vague 3, 13.11.2026)

Mesures avant et après : `docs/rendus/vague-3/tablette/` (`avant-mesures.json`, `apres-mesures.json`), avec `scripts/tablette/rush.mjs` puis `scripts/tablette/mesurer.mjs` sur la base embarquée.

- Les onglets restent collés en haut de l'écran avec l'état du service, la recherche et les réglages.
- Recherche « N°, nom ou tél. » : numéro exact, cinq chiffres ou plus du téléphone (espaces et +41 admis), ou chaque mot dans le prénom ou le nom, sans accents ni majuscules, dans toute la file (terminées comprises). Les commandes encore à faire passent devant.
- Les bandeaux tiennent sur une ligne fine. Les imprimantes hors service sont réunies sur une seule.
- Le retour d'un geste s'affiche en bas de l'écran pendant 8 secondes, même au fond d'une longue liste.
- Commande acceptée ou en préparation : temps restant sous l'heure promise (« dans 12 min »), puis « En retard de N min », heure en négatif et cadre épais une fois l'heure passée. Prête ou partie, la marque disparaît : la cuisine a fini.

### Mode d'emploi en service (à imprimer pour la cuisine)

Onglet « En cours » :

- Une ligne par commande, la plus pressée en haut : d'abord celles en retard, puis celles à lancer maintenant, puis les autres dans l'ordre où il faut les lancer. Une livraison loin passe avant un retrait proche. Les commandes prêtes ou parties sont en bas.
- Chaque ligne dit ce qui presse : « En retard de 4 min » (heure en blanc sur noir, ligne encadrée), « À lancer » (trait épais à gauche), « À lancer dans 12 min », « À sortir dans 6 min ». Sous les onglets, le compteur dit combien sont en retard et combien sont à lancer maintenant.
- Le bouton à droite de la ligne fait le pas suivant d'un seul geste : « Prête » (à emporter, le client reçoit un e-mail), « Partie » (livraison), « Retirée », « Livrée ». Payée au comptoir, deux boutons disent comment : « Retirée, espèces » ou « Retirée, carte ». Retirée sans être encaissée, elle garde « Espèces » et « Carte » dans « Terminées ».
- Toucher la ligne ouvre la commande en entier à côté : plats et options, client, « Changer l'heure », « Il manque… », « Annuler la commande », tickets. « Fermer » la referme. Sur un téléphone, elle couvre la liste.
- Pendant qu'on touche la liste, elle ne se réordonne pas : l'ordre change 8 secondes après le dernier appui.
- En livraison, donner la commande à un livreur dans l'onglet « Livraisons ». Il touche « Je pars » puis « Livrée » sur son téléphone. Sans téléphone, toucher ici « Partie » puis « Livrée » à son retour.
- Le résultat d'un bouton (« Commande refusée et remboursée », « Tickets prévus à 18h30 ») s'affiche en bas de l'écran pendant 8 secondes. « OK » le ferme.

### Tableau « En cours » (vague 3)

- « En cours », « À l'avance », « Terminées » et la recherche affichent une ligne par commande (`LigneCommande.tsx`) : numéro, heure promise et ce qui presse, mode, client, livreur, plats en résumé, montant à encaisser, et un bouton pour le pas suivant. « À accepter » garde ses cartes (l'heure s'y règle).
- Tri de « En cours » (`etatTemps` dans `src/components/tablette/rush.ts`) : en retard d'abord (le plus ancien en tête), puis par heure de lancement, prêtes et parties à la fin. Heure de départ : heure promise pour un retrait, moins le trajet de la zone pour une livraison. Trajet : délai minimal de la zone moins la préparation (le retard du soir et l'allongement s'ajoutent aux deux). Heure de lancement : départ moins la préparation habituelle. La file envoie `rythme: { preparation, trajets }`.
- Toucher une ligne ouvre la carte complète à côté (sous la barre, par-dessus la liste sous 900 px). Le détail ne s'affiche que si sa commande est dans la liste à l'écran.
- L'ordre de « En cours » reste figé 8 secondes après un appui sur le tableau (`ordreStable`). Compteur « N en retard » et « N à lancer maintenant » sous les onglets. L'état des imprimantes ne s'écrit qu'une fois : « Imprimantes en ligne. » ou leur bandeau.

### File allégée (vague 3)

Mesures de qualite (`docs/charge.md`) : 163 à 185 Ko par relecture et par tablette, toutes les 5 à 15 secondes. Mesure locale sur le jeu de rush (148 commandes, dont 109 actives), `scripts/tablette/poids-file.mjs` :

| Relecture | Avant | Après |
|---|---|---|
| Réponse complète | 157,8 Ko | 146,2 Ko |
| Rien n'a changé | 161 Ko | 0 octet (204) |

- Les commandes terminées ou refusées partent sans leurs lignes (`lignes_omises`). Leur détail (lignes et tickets) se charge au toucher par `GET /api/tablette/commande?id=…`, de nouveau si la file change tant qu'il est ouvert. Statut et paiement viennent toujours de la file. Les tâches d'impression ne concernent que les commandes actives.
- Version : `versionFile` (`src/lib/tablette-file.ts`) hache tout ce que l'écran affiche, sauf l'heure. Une imprimante en ligne relue toutes les 10 s ne la change pas. La tablette renvoie `?version=` (en-tête `X-Version-File` de la réponse précédente). Rien de changé : 204 sans corps, l'heure du serveur dans `X-Maintenant`.
- Le signe de vie (`?service=1`) et la surveillance passent avant la comparaison : une tablette calme reste « vivante » (test : 204 répétés pendant 4 minutes, `tests/unit/tablette-file.test.ts`).
- La tablette garde l'écart entre son horloge et celle du serveur et recalcule toutes les 15 s ce qui dépend du temps (retards, « à lancer dans », passage d'« À l'avance » à la file) sans attendre de nouvelle donnée.
- Test e2e (proposé par qualite) : relectures remplacées par des 204 portant une heure avancée de 40 minutes, « Attend depuis » monte et une commande d'« À l'avance » passe dans « En cours ».
- Les livraisons ne sont relues que si l'onglet « Livraisons » est ouvert ou qu'une livraison est en cours.
- Piste suivante (qualite) : une fonction SQL de version (dernière modification des commandes du jour, des réglages et des tâches) pour ne même plus lire `file_tablette` quand rien n'a changé.

## Correctifs du 13.11.2026 (audit « samedi soir »)

Détail : `docs/audits/samedi-soir.md`, « Suivi des corrections ».

- Chaque geste envoie l'état que la tablette affichait. Si une autre tablette a changé la commande entre-temps, rien ne se fait et l'écran le dit.
- Annuler une commande acceptée retire ses tickets de la file et imprime « ANNULÉE, NE PAS PRÉPARER » aux postes qui avaient déjà le leur.
- Refus d'une commande payée quand le remboursement échoue : le client reçoit « refusée, remboursement en cours », le restaurant une alerte, la tablette un bandeau. La commande reste dans « Terminées » avec « Rembourser » jusqu'au remboursement, même les jours suivants.
- Une commande payée pendant une pause, après une rupture ou trop tard pour son heure arrive avec un avertissement jaune.
- Retrait payé au comptoir : retirée et encaissée d'un seul geste, en disant comment (vague 3 : « Retirée, espèces » ou « Retirée, carte », `commandes.moyen_comptoir`, pour la clôture du jour de bo-pilotage). Une commande retirée sans être encaissée garde « Encaissée en espèces » et « Encaissée par carte » dans « Terminées ». Sans la migration `20261203090000_tablette_encaissement.sql`, l'encaissement est noté sans le moyen.
- Annulation faite par le client (`annulee_par_client_le`, #70) : bandeau noir « Annulée par le client : 47 à 19h42. Ne pas préparer, mettre de côté ce qui est lancé. » pendant 20 minutes ou jusqu'à « Vu », avec une note grave et courte, une fois par commande (pas au rechargement de la page). La ligne dit « Annulée par le client à 19h42 ».
- Seul un appareil qui a touché « Démarrer le service » (ou « Continuer sans son ») donne le signe de vie surveillé par le serveur. Le son est relancé au retour de veille.
- Une commande acceptée sans ticket affiche « Ticket non créé » et « Réimprimer ».
- Numéros : une commande à l'avance prend un numéro du jour où elle est servie.

## Commandes à l'avance (SS-11, G08, 13.11.2026)

- Accepter une commande pour ce soir ou un autre jour confirme l'heure au client tout de suite (e-mail), sans imprimer. La tablette répond « Acceptée. Tickets prévus … ».
- Les tickets sortent avant l'heure promise, selon le mode : 60 minutes pour une livraison (50 minutes de délai maximal en zone 2, plus 10 de marge), 30 minutes pour un retrait (20 minutes de préparation, plus 10). Valeurs validées par Jérémy le 12.11.2026, réglables dans le back-office. La surveillance du serveur les crée, même tablette éteinte et même pendant une pause.
- Heure changée avant l'impression : le ticket sort à la nouvelle heure moins le réglage, avec la nouvelle heure. Annulée avant l'impression : aucun ticket, ni normal ni « ANNULÉE ».
- « Imprimer maintenant » sort les tickets tout de suite ; la surveillance ne les refait pas ensuite.

## Risques assumés

- Le canal Realtime `tablette` est public : un tiers peut y envoyer des messages vides, qui font seulement relire la file. Aucune donnée n'y passe.
- Le membre de test `equipe@laferme.test` n'existe plus que dans la base embarquée (`supabase/local/donnees-test.sql`). La migration `20261112090000_correctifs_securite.sql` le retire de la vraie base avec ses sessions. Sur une préversion branchée sur la vraie base, la connexion du personnel attend le serveur d'envoi.

## Correctifs du 14.11.2026 (audit « journée du gérant »)

Détail : `docs/audits/gerant.md`, « Suivi des corrections ».

- « Retard ce soir » (0 à 90 minutes) remplace le délai de préparation sur la tablette : il s'ajoute à l'heure annoncée pour le retrait et à chaque zone de livraison. Le délai habituel se règle au back-office.
- Chaque nuit à 5h (heure de Genève), le premier tour de surveillance remet à zéro le retard, rouvre la livraison et lève une « Pause jusqu'à reprise ». Une pause automatique (tablette muette) reste : il faut la lever en regardant la tablette.
- Annuler à la demande du client : motif « À la demande du client », bouton « Annuler et rembourser ». Le client lit « Votre commande est annulée, comme vous nous l'avez demandé ». Le lien qui ferme le panneau s'appelle « Fermer ».

## Vague 2 (16.11.2026, audit du gérant)

- Suppléments épuisés pour la journée, comme les plats (`options.rupture_jour`, colonne `rupture` en fin de la vue `options_publiques`). Le panier refuse un supplément épuisé, la fiche plat le grise.
- « Il manque… » sur une commande acceptée : on coche le plat (et combien) ou le supplément qui manque, la base calcule le montant (prix de la ligne, prix payé du supplément, figé avec la commande ; jamais plus que le total de la ligne moins ce qui en a déjà été rendu), puis on confirme. Payée en ligne : remboursement Stripe partiel, clé du geste comme clé d'idempotence. Au comptoir pas encore payé : déduit de ce qu'il reste à encaisser. Le client reçoit un e-mail. Tout membre actif peut le faire tant que la commande est acceptée ou en préparation (même limite que l'annulation) ; une fois prête ou partie, le gérant seulement. Le remboursement libre reste au gérant.
- « Déconnexion » demande une confirmation (G16). « Attend depuis » ne s'affiche plus sur une commande pour un autre jour (G19).

## Livreurs (vague 2)

Onglet « Livraisons » : donner une livraison acceptée à un livreur, ordre de passage proposé ou à la main, réattribuer, reprendre, problème signalé par le livreur (bandeau jaune). Une livraison partie peut désormais être annulée depuis « En cours ». Détail : `docs/livreurs.md`.

## Coup de feu sur la tablette (vague 3)

Bloc en tête de « Pause, délai, ruptures ». Mêmes fonctions que le back-office (`src/lib/coup-de-feu.ts`, bo-operations, `docs/coup-de-feu.md`), route `/api/tablette/coup-de-feu`.

- Deux gestes : choisir la durée (30 min, 1 h, 2 h ou la durée proposée), puis « Lancer jusqu'à 21h10 ». Retard et commandes par créneau suivent les valeurs proposées (`coup_de_feu_defaut`, réglées au back-office). « Fin du coup de feu » en un geste. Tout revient seul à l'heure de fin.
- Qui : le gérant toujours. L'équipe de service seulement si le réglage `coup_de_feu_par_equipe` est vrai. **Construit désactivé** (migration `20261203100000_tablette_coup_de_feu.sql`, décision de Jérémy). Le réglage est relu à chaque requête : le couper agit tout de suite. Pour l'ouvrir : `update reglages set valeur = 'true', proposition = false where cle = 'coup_de_feu_par_equipe';`
- Réglage faux : l'équipe de service ne voit pas le bloc, sauf pour lire qu'un coup de feu lancé par le gérant est en cours (sans bouton). Le rôle « responsable » n'y a pas accès (la base le refuse, `equipe_nom`).
- Captures : `docs/rendus/vague-3/tablette/coup-de-feu-*.png` (`scripts/tablette/coup-de-feu.mjs`, compte gérant de test). Tests : `tests/unit/tablette-coup-de-feu.test.ts`.

## Numéro d'un autre jour (vague 3, relevé par qualite)

Les numéros recommencent chaque jour. Une commande reçue un autre jour (refusée dont le remboursement n'est pas passé, commande à l'avance) porte sa date sous le numéro, « du 4 nov. », dans la liste comme dans le détail : on ne la confond plus avec le 130 du soir. Classe `tab-autre-jour` sur la ligne et la carte (les tests e2e visent `:not(.tab-autre-jour)`). Capture : `docs/rendus/vague-3/tablette/numero-autre-jour-paysage-1024.png` (`scripts/tablette/numero-autre-jour.mjs`, jeu de rush).

## Horodatage par poste : `commande_postes` (vague 3)

Accords de bo-pilotage (temps réels contre promis) et de bo-operations (file réelle de `charge_cuisine()`). Migration `20261203120000_commande_postes.sql`, aucune fonction partagée recréée : deux déclencheurs sur `commandes`.

| Colonne | Rempli quand |
|---|---|
| `a_faire_le` | Premiers tickets (`tickets_le`, `premiers_tickets`). Une seule fois : une réimpression ne le change pas. Commande à l'avance : à la sortie de ses tickets (60 ou 30 min avant), pas à l'acceptation. |
| `lance_le` | Le poste touche « Lancée » sur la vue par poste (facultatif). |
| `pret_le`, `pret_par` | Le poste touche « Prête » (`tablette:Prénom`), sinon la commande passe prête, partie ou terminée (`statut`, heure déduite). |

- Une ligne par poste présent dans les lignes de la commande. Refusée ou annulée : `pret_le` reste vide.
- Index partiel `(station) where pret_le is null`. RLS activée, aucun droit pour `anon` ni `authenticated`, `service_role` seulement.
- `postes_actifs()` : postes des commandes en cuisine ou sorties depuis moins de 30 minutes (pour la tablette). `marquer_poste(commande, station, 'lancer' | 'pret' | 'rouvrir', personnel)` : équipe du restaurant seulement, commande encore en cuisine.
- Commandes en cuisine au moment de la migration : ajoutées avec leur `tickets_le`.

## Ticket de test (vague 3, pour le back-office de bo-operations)

Le gérant vérifie qu'une imprimante sort un ticket sans passer de vraie commande (`docs/impression.md`, S13). Migration `20261203110000_ticket_de_test.sql`, serveur `src/lib/impression/test.ts`.

- `imprimerTicketTest(imprimanteId, personnel)` : `{ ok: true, tache }` ou `{ ok: false, erreur }` en français (« Réservé au gérant. », « Imprimante inconnue. », « Imprimante désactivée : réactivez-la avant le test. »). Le bouton est au back-office (bo-operations).
- Base : `ticket_de_test(p_imprimante smallint, p_personnel uuid)`, gérant revérifié, imprimante active, journalisé (`journal_gestion`, objet `imprimante`, clé `ticket_de_test`). Tâche `essai` sans commande : `taches_impression.commande_id` devient nullable, contrainte « commande ou essai ».
- Ticket : « TEST », poste et nom de l'imprimante, date et heure de Genève, qui l'a demandé, « Si ce ticket sort, l'imprimante est bien branchée. ». CloudPRNT l'envoie et le confirme comme les autres, fonctions inchangées.
- Imprimante désactivée ou supprimée avant que l'essai sorte : l'essai est annulé, jamais renvoyé vers une autre imprimante du poste (déclencheur `essai_jamais_deplace`, migration `20261203130000`, relevé par bo-operations).
- La tablette ne montre pas les essais (la file ne garde que les tickets des commandes actives). Pour lire `taches_impression` ailleurs sans les compter : `commande_id is not null`.

## Vue par poste (vague 3, décision D12 à l'essai)

Un écran au poste pizza ou cuisine, **derrière un lien** : `/tablette/poste/pizza` et `/tablette/poste/cuisine`, même connexion que la tablette, pas d'entrée dans le menu tant que Jérémy n'a pas tranché D12 (recommandé : à l'essai au poste pizza, tickets gardés). Route `/api/tablette/poste`, logique pure dans `src/components/tablette/poste.ts`, base `commande_postes` (section « Horodatage par poste »).

- En haut : « Reste à sortir », la somme par plat des commandes en cours du poste (« 12 Margherita »). Au poste pizza, le mot « Pizza » est retiré des noms.
- Au milieu : une fiche par commande, dans l'ordre des tickets. Numéro, mode et heure promise, « Reçue il y a N min » ou « En retard », seulement les lignes du poste avec CHOIX, +, SANS et la note du client en négatif. « Lancée » (facultatif) puis « Prête ».
- En bas : les six dernières sorties (30 minutes), « Rouvrir » en cas d'erreur de doigt tant que la commande est en cuisine.
- « Prête » sur un poste ne change pas le statut de la commande : le comptoir garde « Prête au comptoir ». Les tickets papier continuent de sortir.
- Relecture toutes les 5 s. Hors connexion : « Les tickets papier restent la référence. »
- Captures : `docs/rendus/vague-3/tablette/poste-*.png` (`scripts/tablette/vue-poste.mjs` après `scripts/tablette/rush.mjs`).

## Nouveautés de la commande client (vague 3, colonnes de client-commande)

Migration `20261212110000_tablette_nouveautes_client.sql` (après les colonnes de client-commande, `20261210130000` à `20261210210000` : le préfixe `20261203` passerait avant elles). Elle recrée `file_tablette` (depuis `20261203090000`) et `livraisons_livreur` (depuis `20261119090000`) avec seulement les champs nouveaux. Le code les lit comme facultatifs.

| Donnée | Tablette | Vue par poste | Ticket | Page livreur |
|---|---|---|---|---|
| Allergie | En négatif sur la carte, avant les plats, et sur la ligne du tableau | En négatif en tête de la fiche | « ALLERGIE : … » en tête des deux postes (depuis #74) | Rien |
| Personne qui reçoit (`destinataire`) | « Pour : nom », son téléphone cliquable | Rien | « Pour : nom   téléphone » sous le client | « Pour : nom, commandée par … », « Appeler » la joint elle |
| Couverts et serviettes | « Couverts et serviettes » | Rien | « + COUVERTS ET SERVIETTES » sur le ticket du poste qui fait le sac | Rien |
| Prénom par ligne (`pour`) | « pour Hugo » sous le plat | Sous le plat | « pour Hugo » sous le plat | Rien |

Couverts et prénoms restent éteints côté client (réglages `couverts_actifs` et `prenom_par_ligne_actif`, décisions C8 et C5) : la tablette les montre dès qu'ils arrivent. Captures : `docs/rendus/vague-3/tablette/nouveautes-*.png` (`scripts/tablette/nouveautes-client.mjs`, après `scripts/tablette/rush.mjs`).

## « +N min sur les commandes en cours » (vague 3, P0 de produit-gestion ; base et serveur de bo-operations, #186)

Le retard du soir ne touche que les commandes à venir ; les commandes déjà acceptées gardaient leur heure et leurs clients n'étaient pas prévenus. Route `/api/tablette/decaler` sur `apercuDecalage` et `decalerCommandes` (`src/lib/decalage.ts`, doc `docs/decaler-commandes.md`). Composant `src/components/tablette/Decaler.tsx`.

- Dans « Retard ce soir » : « Décaler les commandes en cours… » montre l'aperçu (« 10 commandes, 10 clients prévenus par e-mail. Décaler de : »), puis « +5 », « +10 », « +15 » ou « +20 min » décale et prévient chaque client. Deux gestes. La clé du geste est tirée à ce moment : un double appui ne décale pas deux fois.
- Sur la vue par poste : « Décaler les commandes pizza… », seulement les commandes que ce poste n'a pas encore sorties.
- Avant la #186 dans main : « Pas encore disponible : réglez le retard ce soir à la place. »
- Captures : `docs/rendus/vague-3/tablette/decaler-*.png` (`scripts/tablette/decaler.mjs`, n'appuie pas sur « +N min »).

## « Four en panne… » et ruptures « jusqu'au » (vague 3, base de bo-carte #55, P0 et P1 de produit-gestion)

Dans « Pause, délai, ruptures ». Même fonction et mêmes mots que le back-office de bo-carte (arbitrage du chef). Aucune migration : `20261210090000_disponibilites.sql`. Routes `/api/tablette/pannes` et `/api/tablette/touchees`, logique pure dans `src/components/tablette/ruptures.ts`.

- **« Four en panne… »** : « Four en panne », « Cuisine en panne » ou « Une catégorie… », puis « Jusqu'à ce soir » ou « Jusqu'à demain soir » (deux gestes, `regler_rupture_groupee`). Cadre « Tout le poste pizza épuisé jusqu'à ce soir. » et « Remettre en vente » d'un geste ; les ruptures plat par plat restent telles quelles. Le client voit ces plats épuisés.
- **Commandes en cours qui les contiennent** : après une panne ou « Épuisé » sur un plat, la liste des commandes à accepter, acceptées ou en préparation jusqu'à la date, avec leurs lignes concernées. Chaque « N° » ferme les réglages, cherche le numéro et ouvre la commande. Base : `commandes_touchees` de bo-carte (PR à venir) ; repli calculé sur la file de la tablette tant qu'elle n'est pas dans main.
- **Motif sous le plat** : « Four en panne », « Cuisine en panne », « Toute la catégorie épuisée » ou « Épuisé jusqu'au 15 nov. ». Un plat épuisé avec son poste ne se remet pas seul (bouton grisé). Le résumé « Épuisés aujourd'hui » ne liste pas les plats d'un poste en panne.
- **Confirmation sur la ligne** avant de remettre une rupture posée au back-office pour plusieurs jours, et avant d'épuiser le dernier choix disponible d'un groupe obligatoire.
- Suppléments et choix regroupés par groupe, « choix obligatoire » noté à côté du nom.
- Captures : `docs/rendus/vague-3/tablette/panne-*.png` (`scripts/tablette/pannes.mjs`, après `scripts/tablette/rush.mjs`).

## Ticket « MODIFIÉE » (vague 3, contrat avec bo-commandes, #65)

Une commande acceptée dont le client, le téléphone, les consignes ou l'adresse changent après la sortie de ses tickets : un ticket « MODIFIÉE » au poste qui fait le sac (cuisine s'il y a des lignes cuisine, sinon pizza). Les plats ne changent jamais par ce chemin.

- `imprimerModification(commandeId, changements)` (`src/lib/impression/modification.ts`), changements `{ champ, avant, apres }` lisibles (« Téléphone », « Consignes », « Adresse »). Appelée par `modifierCommande` (bo-commandes) après `modifier_commande`, seulement si quelque chose a changé ; un échec n'empêche pas la modification.
- Ticket (`ticketModification`, `src/lib/impression/ticket.ts`) : « MODIFIÉE », mode et numéro, heure de la modification, puis pour chaque changement l'ancienne valeur et la nouvelle en négatif, puis l'état à jour (client, « Pour : … », adresse et consignes).
- Rien si les premiers tickets ne sont pas sortis (ils porteront les nouvelles valeurs), ni pour une commande terminée, refusée ou annulée, ni sans vrai changement. Renvoie le nombre de tickets créés. Pas de migration (`creer_taches_impression`, comme une réimpression).

## Page livreur d'une main (vague 3)

Styles propres dans `src/components/livreur/livreur.css`. L'ordre de passage reste celui proposé à l'attribution (`proposerOrdre`) ou rangé à la tablette.

- Avant le départ : tous les arrêts ouverts, pour vérifier les sacs. « Je pars avec les N » d'un geste.
- En route : l'arrêt en cours (le premier pas encore livré) est seul ouvert ; les suivants tiennent sur une ligne (rang, heure, adresse, état, numéro) et s'ouvrent au toucher. En bas de l'écran, sous le pouce : « Itinéraire » et « Livrée, n° 17 » de l'arrêt en cours. Avant : trois arrêts faisaient six écrans de haut et « Livrée » était au milieu.
- Captures : `docs/rendus/vague-3/tablette/livreur-375.png`, `livreur-375-entier.png`, `livreur-375-en-route.png`, `livreur-320.png` (`scripts/tablette/livreur.mjs`, après `scripts/tablette/rush.mjs`).

## Sons distincts et acceptation en série (vague 3)

Module `src/components/tablette/sons.ts`. Le navigateur n'autorise le son qu'après « Commencer le service ».

| Ce qui arrive | Son | Combien de fois |
|---|---|---|
| Nouvelle commande à accepter | Deux notes (aiguë, puis plus basse) | Toutes les 4 s tant qu'elle attend, toutes les 2 s dès 3 minutes d'attente |
| Commande qui passe en retard | Trois notes graves rapprochées | Une fois par commande |
| Imprimante hors ligne, sans papier, capot ouvert ; problème signalé par un livreur | Deux notes qui descendent | Une fois par problème (un nouvel état de l'imprimante sonne de nouveau) |
| Annulation par le client | Une note grave et longue | Une fois par commande (#115) |

Au chargement de la page, rien ne sonne pour ce qui était déjà là.

**Acceptation en série** : dans « À accepter », à partir de deux commandes, « Accepter les N à l'heure proposée… » puis « Accepter les N ». Chacune est acceptée à son heure proposée, comme le bouton de sa carte. Une commande avec une allergie ou un avertissement (adresse, créneau) n'entre pas dans la série : elle se lit et s'accepte seule. Le retour dit combien sont passées et combien restent à lire. L'acceptation automatique, côté serveur, reste une décision de Jérémy (non construite ici). Capture : `docs/rendus/vague-3/tablette/serie-confirmer-1180.png` (`scripts/tablette/serie.mjs`).

## Raison de l'heure réaliste (vague 3, base et texte de bo-operations)

Sous « Préparation N min », en gras, la raison qui allonge les heures annoncées en ce moment : « Four : 22 pizzas en file, 42 min. Heures annoncées +25 min. » (`raisonCharge`, `chargeDuMoment`, calculés dans la route de la file, jamais dans une page publique). Rien quand rien n'allonge les heures, ce qui est le cas tant que les réglages de l'heure réaliste (`allongement_max_minutes`, débits du four et de la cuisine) restent à zéro.

## « Modifier… » une commande depuis la tablette (vague 3, contrat de bo-commandes #65)

Le client appelle pour corriger son téléphone, son nom ou les consignes de livraison. Bouton « Modifier… » sur la carte (à accepter, acceptée, en préparation), panneau prérempli, seuls les champs changés partent. Route `/api/tablette/modifier` sur `modifierCommande` : le client reçoit le nouveau récapitulatif par e-mail et, si les tickets sont déjà sortis, un ticket « MODIFIÉE » sort au poste du sac. L'adresse se change au back-office (recherche d'adresse et zone).

- Qui : le gérant toujours ; l'équipe de service seulement si `modification_par_equipe` est vrai. **Construit désactivé** (réglage de bo-commandes, décision de Jérémy). La base revérifie.
- Capture : `docs/rendus/vague-3/tablette/modifier-1180.png` (`scripts/tablette/modifier.mjs`, compte gérant, n'enregistre rien).

## Connexion d'un livreur par code (vague 3, D13 point 3 de produit-gestion, construit désactivé)

Zéro e-mail : le gérant ou un responsable touche « Code de connexion » à côté du livreur (onglet Livraisons), la tablette affiche 8 chiffres en grand, valables 10 minutes et une seule fois. Sur `/livreur`, « J'ai un code du restaurant » : le livreur les tape et sa session s'ouvre pour la soirée (12 heures, comme aujourd'hui).

- Migration `20261203150000_code_livreur.sql` : réglage `connexion_livreur_par_code` (faux, proposition), table `codes_livreur` (code en empreinte HMAC seulement), `creer_code_livreur` (gérant ou responsable actif, livreur actif, journalisé ; un nouveau code annule le précédent), `utiliser_code_livreur` (même frein par connexion que la connexion de l'équipe, `attente_limite('echec_ip')` ; ouvre une session de livreur ordinaire, que « Déconnecter un téléphone perdu » coupe comme les autres).
- Serveur `src/lib/personnel/code-livreur.ts`, routes `/api/tablette/code-livreur` (GET `{ actif, autorise }`, POST `{ livreur }`) et `/api/personnel/code-livreur` (POST `{ code }`, contrôle d'origine, cookie `HttpOnly` de 12 heures).
- Relecture de sécurité de qualite (13.11.2026, `revue-securite-pr204.md`) : un responsable ne crée un code que si son rôle est ouvert (droit « deconnecter_appareil » relu par `droit_personnel`, à la création comme pour afficher le bouton). Frein global en plus du frein par connexion : au-delà de 100 codes faux en 10 minutes, toutes connexions confondues, plus aucun code n'est accepté jusqu'à ce que la fenêtre passe, et le restaurant reçoit une alerte (une fois, au 100e).
- Frein par connexion partagé avec la connexion de l'équipe (choix gardé) : un livreur qui se trompe plusieurs fois fait attendre la connexion suivante sur le Wi-Fi du restaurant, puisque tous les appareils y sortent par la même adresse.
- **Pour l'ouvrir** (décision de Jérémy, après la relecture de sécurité de qualite) : `update reglages set valeur = 'true', proposition = false where cle = 'connexion_livreur_par_code';`
- Fermé : aucun bouton sur la tablette, rien de plus sur `/livreur`, et les deux fonctions refusent.

## Retour arrière : « Annuler » pendant 5 secondes (P0 du contrôle de produit-gestion)

Un geste qui change un statut ou écrit un encaissement (« Prête », « Partie », « Retirée », « Livrée », « Retirée, espèces / carte », « Encaissée … ») ne part qu'après 5 secondes. En bas de l'écran : « N° 17 : Prête au comptoir dans 4 s. » et « Annuler ». Pendant ce temps, rien n'est écrit en base, imprimé ni envoyé au client (e-mail « prête » ou « en route ») : annuler ne laisse aucune trace, il n'y a rien à défaire. Un seul geste en attente par commande. Si la page se ferme pendant le délai, les gestes en attente partent tout de suite. Accepter et refuser gardent leur propre confirmation ; « Prête » de la vue par poste a « Rouvrir ». Module `src/components/tablette/differe.ts`.

## Livraisons : livreurs du service et « Donner à… » (P1 du contrôle de produit-gestion)

Avant : un bouton « À <livreur> » pour chaque livreur et chaque commande, et « Donner à <livreur> » sur chaque arrêt (420 boutons à l'écran sur le jeu de rush) ; le planning du service n'était pas lu. Logique pure : `src/components/tablette/livraisons-choix.ts`.

- 4 livreurs actifs au plus : un bouton chacun, comme avant.
- Au-delà : en boutons, les livreurs **prévus au planning du service** en cours (bo-operations, `livreursDuService` ; midi avant 15h, soir après, heure de Genève) et ceux dont la page est ouverte sur le téléphone depuis moins de 6 heures ; les autres dans un menu « Donner à… » par commande et par arrêt. En tête de colonne, les deux sortes nommées à part (M11 de la mise en situation) : « Prévus ce soir : Marco, Inès. Page ouverte sur leur téléphone : Alba. Les autres sont dans « Donner à… ». », ou « Personne au planning de ce soir. »
- Tournées affichées : les livreurs prévus et ceux qui ont encore une livraison (sans planning pour ce service : tout le monde).
- Sur le jeu de rush de qualite (sans planning ce midi) : 25 boutons et 50 menus au lieu de 420 boutons. Capture : `docs/rendus/vague-3/tablette/livraisons-apres-1180.png`.

## Tableau compact et bandeau des remboursements court (P1 du contrôle de produit-gestion)

Mesure sur le jeu de rush de qualite (91 commandes en cours, `scripts/tablette/mesurer.mjs` avec `COMPTE=lea.rush@exemple.test`) :

| Écran | Commandes visibles sans défiler, avant | Après |
|---|---|---|
| Paysage 1024 × 768 | 7 | 11 |
| Paysage 1180 × 820 | 7 | 12 |
| Portrait 820 × 1180 | 11 | 19 |

- Ligne de 46 px au lieu de 68 : bouton de geste à 44 px (taille tactile minimale, aucune cible plus petite), interligne et marges réduits, retard marqué par un contour qui ne prend pas de place, « à encaisser » sur la ligne du client (deux lignes par commande au plus).
- Bandeau des remboursements pas passés sur une ligne : les numéros du jour, puis le nombre des jours d'avant avec leurs dates, et « Voir au back-office » (`/gestion/commandes?remboursement=echec`). Avant : 18 numéros sans date, en permanence (les numéros recommencent chaque jour).
- Captures : `docs/rendus/vague-3/tablette/compact-avant-*.png` et `compact-apres-*.png`, mesures `compact-mesures.json`.

## Position du livreur en direct (décision de Jérémy du 13.11.2026)

« Seulement s'il est en train de livrer sa commande. Le 2e client ne doit pas savoir où il livre au 1er client. » Toutes les règles sont en base, quel que soit le téléphone (migration `20261213210000_position_livreur.sql`).

- **Arrêt en cours** (`arret_en_cours`) : la première livraison encore à faire du livreur, dans l'ordre de sa tournée (le même que sur son téléphone), si elle est partie. Avant le départ, ou si le premier arrêt est encore au restaurant, rien n'est gardé.
- **Téléphone** (`src/components/livreur/partage-position.ts`) : pendant le trajet vers l'arrêt en cours, la page demande la localisation au navigateur et l'envoie toutes les 20 secondes au plus (`/api/livreur/position`, POST `{ lat, lon, precision }`). Sous le pouce : « Le client du n° 17 voit votre position jusqu'à « Livrée ». », ou « Localisation refusée sur ce téléphone. Le client ne voit pas où vous êtes. ». Plus en route ou page fermée : POST `{ fin: true }` efface la position. Un arrêt qui passe à null ne compte qu'au bout de 8 secondes sans retour (`suiviArret`, `DELAI_FIN_MS`) : juste après « Je pars », le rechargement le rend null quelques centaines de millisecondes, et le « fin » envoyé alors effaçait la position écrite juste avant (signalé par client-compte, CI de la #236). La base efface de toute façon la position à la livraison.
- **Base** (`noter_position_livreur`) : une ligne par livreur (`positions_livreur`), remplacée à chaque envoi, au plus une écriture toutes les 10 secondes, coordonnées arrondies à 4 décimales (une dizaine de mètres), sans historique ni journal. Signal hors de la région de Genève ou précision de plus d'un kilomètre : ignoré.
- **Suivi** (`position_pour_suivi`, `src/lib/position-livreur.ts`) : la position n'est lue pour une commande que si cette commande est l'arrêt en cours de son livreur, et seulement si elle a moins de 2 minutes. Le 2e client ne voit rien tant que le 1er n'est pas livré.
- **Point de masquage** (relecture de qualite) : quand l'arrêt en cours suit un arrêt terminé (livré, client absent clos, annulé, retiré), et non le départ du restaurant, le premier point reçu pour ce nouvel arrêt est souvent pris devant la porte du client d'avant. Il est gardé dans la même ligne (`masque_lat`, `masque_lon`, marque `suites_livreur`), et le suivi ne montre rien tant que le livreur est à moins de 400 m de ce point. Deux voisins à moins de 400 m : le 2e ne voit rien, c'est voulu.
- **Course au moment de « Livrée »** (relecture BIS de qualite, migration `20261213230000_position_livreur_course.sql`) : la marque retient l'arrêt terminé (`apres_commande`) et ne s'applique qu'à un autre arrêt. Un point envoyé pendant le geste, encore compté pour l'arrêt qui se termine, ne la consomme donc pas. Un point de plus de 100 m de précision n'est pas pris comme point de masquage : rien n'est écrit, on attend le suivant.
- **Limites acceptées** :
  - le masque est posé au premier point reçu après l'arrêt terminé. Si le livreur touche « Livrée » en repartant, déjà à 150 m, le masque est à 150 m de la porte, et le client suivant peut voir un point à environ 250 m de cette porte, jamais plus près ;
  - le client suivant ne voit son livreur qu'à partir de 400 m du point de masquage : un cercle de quartier, pas une adresse ;
  - si l'arrêt précédent s'est terminé alors que le suivant était encore au restaurant, le masque tombe au restaurant, dont l'adresse est publique : le client ne voit son livreur qu'à 400 m du restaurant.
- **Livreur désactivé** : plus rien au suivi, tout de suite.
- **Effacement** : livrée, client absent clos, annulée, retirée ou donnée à un autre livreur, la position est effacée sur-le-champ (déclencheurs sur `commandes` et `livraisons`). Une position qui n'est plus envoyée est effacée au bout de 15 minutes.
- **Capture** : `docs/rendus/vague-3/tablette/livreur-position-375.png` (e2e livreurs, téléphone en route).
- **Interrupteur** : réglage `position_livreur_en_direct` (vrai). À faux, plus rien n'est gardé ni lu, et le téléphone arrête d'envoyer.
- **En-tête** : `Permissions-Policy` ouvre la géolocalisation pour `/livreur` seulement (`next.config.ts`), elle reste fermée partout ailleurs.
- **Limite connue** : un navigateur de téléphone n'envoie la position que tant que la page est à l'écran. Si le livreur passe sur l'appli de navigation, la position s'arrête et disparaît du suivi au bout de 2 minutes.
- **Carte** : couche grise de swisstopo (`ch.swisstopo.pixelkarte-grau`, Web Mercator, `wmts.geo.admin.ch`), gratuite sans clé ni inscription, mention « © Data: swisstopo » (conditions générales de la IFDG, section 3.1 ; usage raisonnable admis jusqu'à environ 20 000 utilisateurs par jour, section 2.3). Pas de service américain.

## Responsable de service sur la tablette (D1, oui de Jérémy le 13.11.2026)

Liste de bo-socle. Le responsable n'agit qu'avec le réglage `role_responsable_actif` à vrai (posé par le chef sur la vraie base) : sans lui, rien ne change, et un responsable reste un membre de l'équipe de service. Migration `20261213220000_tablette_responsable.sql`.

- **Annuler une livraison partie** : gérant ou responsable (droit « annuler_apres_prete »). La tablette lit le droit pour montrer « Annuler la commande » (`droit_personnel`), la route le revérifie, et la base aussi (`annuler_commande_partie` passe de `gerant_nom` à `auteur_droit`).
- **Modifier une commande** : le responsable a le droit « modifier_commande », comme le gérant, sans le réglage `modification_par_equipe` et même quand la commande est prête ou partie. Route `/api/tablette/modifier` et base (`modifier_commande` accepte le rôle responsable). Rôle éteint : la règle de l'équipe.
- **Coup de feu** : le responsable au rôle ouvert peut toujours, comme le chef d'équipe d'un soir. Rôle éteint : la règle de l'équipe (`coup_de_feu_par_equipe`).
- **Fermer le service du jour** (contrat de bo-operations, `src/lib/fermer-service.ts`) : bloc dans « Pause, délai, ruptures », visible pour le droit « fermer_service ». Quand fermer (ce midi, ce soir, toute la journée), puis le motif, lu par les clients et jamais un nom. Une confirmation dit la suite (« Les clients ne pourront plus commander pour ce soir. »). Après la fermeture : « Fermé pour ce soir. Commandes déjà prises : n° 12, 15. Traitez-les dans « En cours ». ». Seul le gérant rouvre, au back-office. Route `/api/tablette/fermer-service` (GET `{ autorise }`, POST `{ quoi, motif }` derrière `exigerDroit(requete, "fermer_service")`, la date vient de la base).
- Capture : `docs/rendus/vague-3/tablette/responsable-fermer-service.png` (responsable, jusqu'à la confirmation).
- Tests : `tests/unit/tablette-responsable-sql.test.ts` (annuler et modifier, équipe refusée, rôle éteint), e2e `tablette.spec.ts` (bloc jusqu'à la confirmation sans fermer, l'équipe sans bloc et refusée en 403).

## Mise en situation du 13.11.2026 (service complet sur le jeu de rush)

Joué en local : tablette 1024 × 768, téléphone de comptoir 375 et 390 px, téléphone d'un livreur, poste pizza. Corrigé ici :

- **Nouvel employé** : sous la connexion, « Premier service ? Le gérant vous ajoute d'abord à l'équipe, avec votre e-mail. Pas de code au bout de 2 minutes ? Regardez les courriers indésirables, puis demandez-lui. » L'écran dit « Code envoyé » même à une adresse hors de l'équipe (on ne révèle pas qui en fait partie).
- **Son** : après « Continuer sans son », la barre dit « Son coupé. Activer le son ». Avant, il fallait recharger la page.
- **Écran qui s'éteint** : « Continuer sans son » garde aussi l'écran allumé. Si l'appareil refuse, la barre le dit : « Cet appareil peut éteindre l'écran. Réglez sa mise en veille sur « Jamais ». »
- **Remboursements pas passés** : « Voir au back-office » seulement pour qui peut l'ouvrir (droit « voir_commandes »). Pour les autres : « Le gérant les reprend au back-office. »
- **Adresse introuvable** (onglet Livraisons) : le numéro du client cliquable dans le texte du problème. Pour une livraison partie, qui n'a pas le droit de l'annuler lit « demandez au gérant ou au responsable de service d'annuler la commande (elle est remboursée) ».
- **Imprimante en panne** : le bandeau ajoute « Vérifiez le papier et le câble, puis éteignez et rallumez l'imprimante. »
- **Livreur, après « Problème »** : « Le restaurant est prévenu. Attendez son appel, ou appelez-le au 022 792 16 89. »
- **M5, nouvelle livraison** : la page du livreur vibre, sonne et dit « Nouvelle livraison pour vous : n° 17. ». Le bouton « Activer le son et les alertes des nouvelles livraisons » (une fois) débloque le son et demande la permission des notifications : page cachée derrière une autre appli, une notification « Nouvelle livraison, N° 17 » part (iPhone et ordinateur ; Android Chrome demande un service worker, il garde le son et la vibration). Téléphone verrouillé, navigateur fermé : rien, il faudrait des notifications poussées par le serveur.
- **M2, poste pizza** : une commande dont l'heure de mise en route est à venir n'est plus dans la file ni dans « Reste à sortir ». L'en-tête dit « 12 en cours, 34 plus tard (elles arrivent ici à la sortie de leurs tickets) ». En production, elles n'y arrivent qu'à la sortie des tickets ; le garde vaut pour les données importées.
- **M11, Livraisons** : les livreurs prévus au planning et ceux dont la page est ouverte sont nommés à part.
- **M14, Déconnexion à 390 px** : pas reproduit. « Oui, déconnecter » et « Non » s'affichent. Le constat venait sans doute d'un serveur de développement dont le dossier `.next` avait été écrasé par un build e2e (scripts en 404, page jamais chargée).
- Captures : `docs/rendus/vague-3/tablette/mes-*.png` (connexion, son coupé, Livraisons et poste pizza à 1024 px ; déconnexion et page livreur à 390 px).

## Le livreur choisit ses commandes et son ordre ; le gérant ou le responsable peut livrer (réponses de Jérémy du 14.11.2026)

Migration `20261215090000_livreur_choisit.sql`.

- **« À prendre »** (page `/livreur`) : les livraisons acceptées, tickets sortis, sans livreur (`livraisons_a_prendre`). Par commande, le numéro, le NPA et la localité, l'heure promise, le nombre d'articles et de pizzas. L'adresse complète n'arrive qu'une fois la commande prise. Bouton « Je prends » : `prendre_livraison` verrouille la commande et vérifie qu'aucune livraison n'est active (index unique en plus). De deux livreurs au même instant, un seul gagne, l'autre lit « Déjà prise par Marco. » Journal : événement `prise`. L'ordre proposé est recalculé comme à la tablette, sauf ordre déjà fait à la main. Il faut du réseau (pas de file d'attente : la base tranche).
- **Ordre** : « Plus tôt » et « Plus tard » sur chaque arrêt du téléphone (route `/api/livreur/tournee`, `{ action: "deplacer", commande, sens }`), même fonction que la tablette (`ordonner_livraisons`, ordre manuel : il n'est plus recalculé). La tablette garde « Donner à… », « Plus tôt / Plus tard » et la reprise.
- **Position en direct quand l'ordre change** : si l'arrêt en cours change pendant le trajet, `ordonner_livraisons` efface la position et pose la marque de masquage, comme après une livraison. Le premier point du nouvel arrêt devient le point de masquage, et le client B ne voit jamais la porte du client A (test « changer l'ordre en route »).
- **Le gérant ou le responsable peut livrer** (M4) : `peut_livrer` (livreur actif, gérant actif, ou responsable actif quand `role_responsable_actif` est vrai) remplace le contrôle « rôle livreur » dans `attribuer_livraison`, `geste_livreur`, `livreurs_tablette`, `noter_position_livreur` et `position_pour_suivi`. Il ouvre `/livreur` avec son propre compte, sans second compte. À la tablette, il est dans « Donner à… » ; il passe en bouton quand sa page de livraisons est ouverte, et n'a une colonne de tournée que s'il livre. Ses droits ailleurs ne changent pas ; la capacité et le planning comptent toujours les seuls livreurs.
- **Sac** (« c'est nous qui mettons dans le sac ») : le ticket du poste qui fait le sac finit par « SAC : COCHER CHAQUE ARTICLE », une case `[ ]` par article de la commande, tous postes confondus, boissons et desserts compris, puis « [ ] COUVERTS ET SERVIETTES ». Les lignes du poste « comptoir » (bo-carte : boissons et desserts tout prêts) n'ont pas de ticket de préparation, seulement leur case dans le sac. Commande de boissons seulement : un seul ticket, celui du sac, en cuisine.
- Écran : « À prendre » après la tournée, cachée pendant le trajet, les 5 plus pressées d'abord (« Voir les N autres »). Une ligne par commande, « Je prends » à droite. Une commande prise soi-même ne déclenche pas l'alerte « Nouvelle livraison ». Captures : `docs/rendus/vague-3/tablette/livreur-choisit-gerant-390.png` (le gérant ouvre `/livreur`) et `livreur-choisit-je-prends-390.png` (après « Je prends »).
- Tests : `tests/unit/livreur-choisit-sql.test.ts` (à prendre, course, rôles, gérant qui livre et partage sa position, ordre et masquage), `tablette-livraisons-choix.test.ts`, `tablette-nouveautes-client.test.ts` (sac), e2e `livreurs.spec.ts` (deux « Je prends » au même instant, ordre sur le téléphone et à la tablette).

## Commande prise au téléphone (vague 3, bo-commandes ; Jérémy, 14.11.2026 : « on centralise tout »)

- **Où** : bouton « Nouvelle commande (téléphone) » en tête de la file, page `/tablette/telephone` (`src/components/tablette/CommandeTelephone.tsx`). Toute l'équipe de la tablette (service, gérant, responsable), jamais un livreur.
- **Saisie** : livraison ou à emporter, adresse cherchée dans le registre fédéral et contrôlée par `/api/adresse` (zone, frais, minimum), plats avec leurs options (`FichePlat` du site), heure (« dès que possible » ou les créneaux du site), prénom, nom facultatif, téléphone, e-mail facultatif, allergie. Prix, minimum et heure recalculés par `/api/panier` à chaque changement.
- **Serveur** : `POST /api/tablette/telephone` puis `prendreCommandeTelephone` (`src/lib/commande-telephone.ts`). Mêmes contrôles qu'une commande du site (plats et options, zone et registre, minimum, pause, heure possible, plat du jour, capacité du créneau en base). Pas de code promo ni de fidélité.
- **Base** : `creer_commande_telephone` (migration `20261215120000_commande_telephone.sql`) crée la commande par `creer_commande`, la marque `canal = 'telephone'`, l'accepte pour l'heure dite au nom de l'équipier (`tablette:<nom>`), note « prise au téléphone » dans son historique et au journal du back-office (sans nom ni téléphone du client).
- **Paiement** : moyen « comptoir », statut « a_encaisser_retrait », comme un retrait payé au comptoir. Encaissée ensuite en espèces ou par carte (« Encaissée… » sur la tablette, aussi pour une livraison partie ou terminée). Elle compte dans les rapports et la clôture comme une commande au comptoir, puis dans l'export Crésus une fois encaissée.
- **Plafond du comptoir** : il ne s'applique pas à une commande prise au téléphone (`verifier_plafond_comptoir` lit `laferme.canal`, posé par `creer_commande_telephone` seulement). Décision à confirmer par Jérémy.
- **Tickets** : tout de suite si l'heure est proche, sinon à l'heure prévue (même règle qu'à l'acceptation). En-tête « TÉLÉPHONE » et paiement « À ENCAISSER À LA LIVRAISON » ou « AU RETRAIT ».
- **Marque** : « Prise au téléphone » sur la carte de la commande, « (téléphone) » dans la ligne compacte, « Prise au téléphone. » sur la page du livreur, qui lit déjà « À encaisser : CHF … ». Champ `canal` dans `file_tablette` et `livraisons_livreur`.
- **E-mail** : seulement s'il est donné (le récapitulatif, « À payer à la livraison, en espèces ou par carte »). Sans e-mail, aucun envoi ensuite (`envoyerCourriel` ignore un destinataire vide), et la commande ne fait pas de fiche client au back-office.
- Tests : `tests/unit/commande-telephone-sql.test.ts`, `tests/unit/commande-telephone.test.ts`, `tests/e2e/tablette-telephone.spec.ts` (comptes `telephone-{bureau,mobile}@laferme.test`).

