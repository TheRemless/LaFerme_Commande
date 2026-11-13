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

## Ticket de test (vague 3, pour le back-office de bo-operations)

Le gérant vérifie qu'une imprimante sort un ticket sans passer de vraie commande (`docs/impression.md`, S13). Migration `20261203110000_ticket_de_test.sql`, serveur `src/lib/impression/test.ts`.

- `imprimerTicketTest(imprimanteId, personnel)` : `{ ok: true, tache }` ou `{ ok: false, erreur }` en français (« Réservé au gérant. », « Imprimante inconnue. », « Imprimante désactivée : réactivez-la avant le test. »). Le bouton est au back-office (bo-operations).
- Base : `ticket_de_test(p_imprimante smallint, p_personnel uuid)`, gérant revérifié, imprimante active, journalisé (`journal_gestion`, objet `imprimante`, clé `ticket_de_test`). Tâche `essai` sans commande : `taches_impression.commande_id` devient nullable, contrainte « commande ou essai ».
- Ticket : « TEST », poste et nom de l'imprimante, date et heure de Genève, qui l'a demandé, « Si ce ticket sort, l'imprimante est bien branchée. ». CloudPRNT l'envoie et le confirme comme les autres, fonctions inchangées.
- La tablette ne montre pas les essais (la file ne garde que les tickets des commandes actives). Pour lire `taches_impression` ailleurs sans les compter : `commande_id is not null`.
