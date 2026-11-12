# Audit de sécurité 2, site de commande La Ferme (fin de la vague 2)

Audit du 12.11.2026, sur `main` au commit `b4681c9` (PR #19 à #40 comprises). Même méthode que le [premier audit](securite.md) : revue de tout le dépôt avec le skill `security-review` appliqué à l'ensemble, en quatre relectures parallèles (photos et carte ; livreurs, rôles et équipe ; remboursements, journal, zones et impression ; GitHub Actions, sauvegardes, santé et secrets), puis tri par une preuve en local. Seul ce qui a été reproduit, ou qui se lit sans ambiguïté dans le code, est retenu.

Terrain :

- attaques actives sur une instance locale (`BASE_LOCALE=1 npm run build`, `next start -p 3103`, base embarquée PGlite) : 27 routes du personnel jouées avec trois profils (livreur, service, anonyme), photos piégées, gestes de livreur, remboursements, carte ;
- droits SQL relevés dans le catalogue d'une base neuve qui rejoue les 24 migrations : 128 fonctions, toutes les tables, vues et politiques ;
- sur la préversion https://deploy-preview-30--boisterous-beijinho-c37e44.netlify.app, des contrôles passifs seulement (en-têtes, pages fermées, `/api/sante`, `/photos` inconnue, route du livreur sans session) : rien n'y est écrit ;
- réglages du dépôt GitHub lus avec `gh api`, sans rien changer.

Marquage : **vérifié** = reproduit ou lu en direct. **Lu dans le code** = certain à la lecture, pas rejoué. **Supposé** = dépend d'un réglage que je n'ai pas pu voir.

## En bref

Aucun constat bloquant. La vague a été construite avec le même modèle de sécurité que le reste et il tient : chaque route du personnel contrôle le rôle, puis la base le revérifie ; les 128 fonctions SQL sont en `security invoker`, sans SQL dynamique, et 127 sont fermées aux visiteurs (la 128e est le déclencheur `maj_modifie_le`) ; les nouvelles tables ont la sécurité par ligne sans aucun droit pour `anon`. Les corrections S1 à S13 du premier audit tiennent toutes.

Trois constats importants demandent une décision de Jérémy (S2-01, S2-02) ou un travail moyen avant d'ouvrir TWINT (S2-03). Les autres, petits et sûrs, sont corrigés dans la même PR que ce rapport.

## Décisions attendues de Jérémy

| Constat | Question | Recommandation |
|---|---|---|
| [S2-01](#s2-01) | Qui peut annuler une livraison déjà partie, ce qui rembourse le client en entier ? | Le gérant seulement, comme pour un manque après « Prête ». Le service garde « Client absent » (sans remboursement). |
| [S2-02](#s2-02) | Après le lancement, un plat de la carte dont le prix repasse « à valider » reste-t-il en vente ? | Le retirer de la vente jusqu'à validation (comme les plats ajoutés au back-office), et décocher par défaut la case « Prix validé » quand le prix change. |
| [S2-10](#s2-10) | Un plat du jour à CHF 0 est accepté et vendu tout de suite. Plancher ? | Refuser un prix de plat à 0 (une option peut rester gratuite). |
| [S2-14](#s2-14) | Le lien « Itinéraire » du livreur met l'adresse du client dans l'URL de Plans ou Google Maps, alors que la règle du projet l'interdit. | Garder le lien (c'est le geste utile au livreur) et écrire l'exception dans la règle. |
| [S2-15](#s2-15) | Session de 60 jours sur le téléphone personnel d'un livreur. | 12 heures pour le rôle livreur (une soirée), 60 jours gardés pour la tablette. |

## Suivi des corrections

| Constat | État | Ce qui a changé |
|---|---|---|
| S2-01 | décision de Jérémy | |
| S2-02 | décision de Jérémy | |
| S2-03 | non corrigé | Effort moyen : lire l'état du remboursement chez Stripe et traiter `charge.refund.updated`. À faire avant d'activer TWINT en production. |
| S2-04 | corrigé | Réponse ambiguë de Stripe : `503` au lieu de `409`, la fiche garde sa clé et un nouvel essai reprend le même remboursement. |
| S2-05 | corrigé | Migration `20261121090000_securite_2.sql` : « Compris » seulement sur une livraison du livreur. |
| S2-06 | corrigé | Même migration : aucun problème signalé sur une livraison close, gestes rejoués sans ligne de journal, verrous dans l'ordre de la tablette. |
| S2-07 | corrigé | Même migration : le gérant est revérifié après le verrou de `modifier_personnel`. |
| S2-08 | corrigé | Même migration : écriture retirée à `anon` et `authenticated` sur les quatre vues publiques. |
| S2-09 | procédure | Ligne ajoutée à la phase 4 de `docs/mise-en-ligne.md` : plats, plats du jour, photos et comptes créés sur les préversions. |
| S2-10 | décision de Jérémy | |
| S2-11 | corrigé en partie | `/photos/<id>.jpg?…` répond 404 sans lire la base. Pas fait : purge du cache à un retrait de photo (procédure dans le constat). |
| S2-12 | corrigé en partie | `psql` en `VERBOSITY=terse` dans la restauration d'essai, `persist-credentials: false` sur les trois `checkout`, copies et clé de sauvegarde dans `.gitignore`. Pas fait : mot de passe hors de la ligne de commande dans `restaurer.sh`, réglages du dépôt (Jérémy). |
| S2-13 | non corrigé | Petit, mais touche `signaler_manque` (objet partagé) : à faire avec la session du gérant. |
| S2-14 | décision de Jérémy | |
| S2-15 | décision de Jérémy pour la durée | Pas fait : vider les gestes en attente à la déconnexion (risque de perdre un « Livrée » non envoyé, à faire avec la session des livreurs). |
| S2-16 | corrigé | E-mail d'un nouveau membre normalisé comme à la connexion. |
| S2-17 | non corrigé | À retirer avant le lancement (fermée en production de toute façon). |

## Les constats

| # | Constat | Gravité | Effort |
|---|---|---|---|
| [S2-01](#s2-01) | Un membre « service » annule une livraison partie : la commande est remboursée en entier, ce qui contourne « client absent sans remboursement » | important | petit |
| [S2-02](#s2-02) | Un plat de la carte remis « à valider » reste en vente au nouveau prix, et bloquera tout build de production après le lancement | important | petit |
| [S2-03](#s2-03) | Un remboursement est noté « fait » dès sa création chez Stripe, même s'il échoue ensuite | important avant TWINT | moyen |
| [S2-04](#s2-04) | Après une réponse ambiguë de Stripe, la fiche jette sa clé : un second clic crée un second remboursement | important | petit |
| [S2-05](#s2-05) | « Compris » accepté sur la livraison d'un autre livreur | confort | petit |
| [S2-06](#s2-06) | Gestes acceptés après « Livrée », et interblocage possible avec la tablette | confort | petit |
| [S2-07](#s2-07) | Un gérant retiré pendant son propre geste le termine quand même | confort | petit |
| [S2-08](#s2-08) | Les quatre vues publiques gardent les droits d'écriture par défaut de Supabase | confort | petit |
| [S2-09](#s2-09) | Le build de production ne voit pas les plats, photos et comptes créés sur les préversions | important | petit |
| [S2-10](#s2-10) | Plat du jour à CHF 0 vendu tout de suite | confort | petit |
| [S2-11](#s2-11) | Photos : paramètres d'URL qui contournent le cache, photo retirée gardée un an en cache | confort | petit |
| [S2-12](#s2-12) | Sauvegardes et GitHub Actions : données de clients possibles dans le journal, jeton GitHub gardé, mot de passe en argument | confort | petit |
| [S2-13](#s2-13) | Manque d'un supplément remboursé au prix actuel de l'option, sans plafond par ligne | confort | petit |
| [S2-14](#s2-14) | Adresse du client dans l'URL d'itinéraire | décision | petit |
| [S2-15](#s2-15) | Téléphone du livreur : session de 60 jours, gestes en attente gardés après la déconnexion | confort | petit |
| [S2-16](#s2-16) | E-mail d'un nouveau membre pas normalisé comme à la connexion | confort | petit |
| [S2-17](#s2-17) | `/api/diagnostic/images` ouverte sans session sur les préversions | confort | petit |

## Ce qui marche bien (vérifié)

| Domaine | Ce qui tient | Preuve |
|---|---|---|
| Rôles, route par route | Un livreur reçoit 403 sur les 11 routes de la tablette et les 14 du back-office. Un membre « service » reçoit 403 sur le back-office et sur `/api/livreur`. Sans session : 401 partout. Le rôle est relu en base à chaque requête : un changement de rôle ou un retrait vaut tout de suite. | essai local avec trois profils ; `personnel/session.ts:52`, `personnel_de_session` |
| Livreur | Il ne voit que ses livraisons en cours. Après « Livrée », la commande disparaît de sa liste. Une livraison annulée ne montre que son numéro. Inès ne voit pas les livraisons de Marco et ne peut pas les marquer livrées (« Cette livraison n'est plus à vous »). Pas d'e-mail ni de nom de famille du client. Réponses `no-store, private`. | essai local ; `livreurs.sql:381`, `api/livreur/route.ts:7` |
| Dernier gérant | Verrou sur les gérants actifs puis comptage : deux gérants qui se rétrogradent en même temps ne laissent pas la maison sans gérant. | `livreurs.sql:62` et `:84` |
| Envoi de photos | SVG et HTML annoncés en JPEG : refusés (octets magiques). JPEG suivi de HTML : accepté mais réencodé, le HTML disparaît. PNG de 900 Mpx en 109 Ko : refusé en 5 ms. Photo trop petite, plat inconnu : refusés. Sans `Origin` du site : 403. EXIF retirés. Gérant exigé en route et en base. | essai local ; `photo-envoi.ts:25` à `:63`, `api/gestion/photo/route.ts:17` |
| Service des photos | Nom filtré par une regex UUID (`/photos/..%2f..` : 400 sur la préversion). `image/jpeg`, `nosniff`, `X-Frame-Options: DENY`. Photo retirée : 404 aussitôt côté serveur. `next/image` refuse une adresse extérieure. | essai local et préversion |
| Carte | Prix négatif, au-delà de CHF 500 ou à plus de deux décimales : refusé. `origine` jamais modifiable : un plat ordinaire ne peut pas emprunter le chemin du plat du jour pour échapper à la validation. Plat retiré ou d'un autre jour : sorti de `carte_publique` par la sécurité par ligne, revérifié au paiement. Le prix facturé vient de la base. | `gestion.ts:14`, `carte_gestion.sql:273`, `:325`, `commandes/route.ts:101` |
| Remboursements | Verrou par clé, `FOR UPDATE` sur la commande, somme `en_cours` + `fait` jamais au-dessus du total, montant entier et positif, gérant seulement après coup. Au comptoir, rien n'est envoyé à Stripe. Le manque refuse un élément déjà signalé. Deux tablettes : `changer_statut` avec l'état attendu sous verrou. | `correctifs_gerant.sql:184` à `:221`, `gerant_vague2.sql:101` à `:160` |
| Journal | Retour arrière réservé au gérant, une seule fois (`annule_par` sous verrou), par les fonctions validées : il ne donne rien de plus que ce que le gérant fait déjà. Équipe, remboursements, import et imprimantes ne s'annulent pas. | `gerant_vague2.sql:400` à `:497` |
| Réglages | Bornes en route et en base (préparation, retard, capacité, impression à l'avance, plafond du comptoir de 0 à CHF 500). Le service ne règle depuis la tablette que la pause, la fermeture de la livraison et le retard. | `tablette/reglages/route.ts`, `gerant_vague2.sql` |
| Impression à l'avance | Un seul premier ticket (`tickets_le` sous verrou). Le passage planifié exige le jeton de la fonction. | `impression_a_lavance.sql:30`, `api/surveillance/route.ts:12` |
| Droits SQL | 0 table sans sécurité par ligne. Sur les tables, `anon` et `authenticated` n'ont que `SELECT`, et seulement sur les 12 tables publiques. 0 `security definer`, 0 SQL dynamique. Chaque `create or replace` d'un objet partagé garde ses droits ; `changer_statut`, supprimée puis recréée, a son `revoke`. Contraintes en liste recréées sans perte de valeur. | catalogue d'une base neuve (requête dans ce rapport, section « Méthode ») |
| GitHub Actions | `permissions` en lecture, aucun déclencheur dangereux (`pull_request_target`, `workflow_run`), aucune interpolation d'événement dans un `run:`, actions épinglées par SHA. Sauvegarde chiffrée par `age` avec la seule clé publique avant tout dépôt, copie en clair dans `/dev/shm` effacée en sortie. Rôle `sauvegarde` en lecture seule. Restauration en une seule transaction. | `verifications.yml:13`, `sauvegarde.yml:14`, `sauvegarder.sh:15` à `:50` |
| `/api/sante` | Aucune donnée personnelle, lecture d'une seule ligne, garde de 15 s par instance, `no-store`. | préversion, `api/sante/route.ts:12` |
| Secrets | Aucune clé dans l'historique (Stripe, Resend, JWT, Supabase, Postgres, `age`) : seulement des valeurs factices. | `git log --all -p` |

### Les corrections du premier audit

| Constat | Tient ? | Preuve |
|---|---|---|
| S1 code à l'écran | oui | sur la préversion, demande de code : 503 « attend l'envoi des e-mails » (12.11, préversion 27) ; `environnement.ts:9` inchangé |
| S2 paiement simulé | oui | `passerelle.ts:42` à `:50` |
| S3 restes de test | oui, à compléter | voir S2-09 |
| S4 force brute | oui | 8 chiffres pour le personnel, 15 essais par jour, alerte au blocage (PR #27) |
| S5 comptoir | oui | `limite_comptoir` et plafond de CHF 100 revérifié par la base (`commandes/route.ts:109`, `:166`) |
| S6 `SECRET_COMPTES` | oui | `comptes/securite.ts:13` |
| S7 contexte local | oui | `verifierContexte()` appelée par `db/serveur.ts:13` et `comptes/securite.ts:47` |
| S8 écriture des visiteurs | oui sur les tables | les vues n'étaient pas couvertes : S2-08 |
| S9 en-têtes | oui | préversion : `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `noindex`, sur toutes les pages essayées, `/photos` et `/livreur` compris |
| S10 surveillance | oui | `/api/surveillance` en GET : 405, en POST sans jeton : refusé |
| S11 durée des réponses | oui | inchangé depuis la PR #27 |
| S12 dépendances | oui | `npm audit --omit=dev` : seulement PostCSS par `next` 15.5.29, non exploitable ici |
| S13 imprimante | procédure | inchangé |

## Constats détaillés

<a id="s2-01"></a>
### S2-01. Un membre « service » annule une livraison partie, remboursée en entier

- **Gravité** : important. Contourne deux règles de Jérémy (client absent sans remboursement, décision du 12.11.2026 ; une fois prête ou partie, seul le gérant rend de l'argent).
- **Où** : `src/lib/tablette.ts:157` à `:181` (`refuser` d'une commande `partie` appelle `annuler_commande_partie`, puis `rembourserCommande` pour toute commande payée en ligne), `supabase/migrations/20261119090000_livreurs.sql:104` (aucun contrôle de rôle), bouton « Annuler » de la tablette.
- **Étapes** (vérifié en local) :
  1. Commande en livraison payée en ligne, acceptée, attribuée à Marco, « Je pars » sur son téléphone.
  2. Session « service » : `POST /api/tablette/action` avec `{"action":"refuser","de":"partie","motif":"Client absent"}`.
  3. Réponse : `{"ok":true,"message":"Commande refusée et remboursée."}`.
- **Attendu** : client absent, pas de remboursement ; tout remboursement après « partie » passe par le gérant.
- **Observé** : n'importe quel membre de l'équipe rend tout l'argent d'une commande déjà livrée ou en route, avec le motif de son choix.
- **Impact** : remboursement par erreur (le bon geste était « Client absent ») ou par complaisance, sans le gérant.
- **Correction proposée** (choix de fonctionnement, donc pas faite) : pour une commande `partie`, « Annuler » réservé au gérant, dans `agir` et dans `annuler_commande_partie` (rôle revérifié en base). Le service garde « Client absent », qui clôt sans rembourser.
- **Effort** : petit.

<a id="s2-02"></a>
### S2-02. Un plat de la carte remis « à valider » reste en vente

- **Gravité** : important après le lancement.
- **Où** : `supabase/migrations/20261118090000_carte_gestion.sql:92` (le déclencheur `verifier_plat_en_vente` ne contrôle que les plats ajoutés au back-office, `origine <> 'carte'`), `:342` (un nouveau prix sans « prix validé » remet `prix_a_valider` à vrai, le plat reste commandable), `src/components/gestion/GestionCarte.tsx:258` (case « Prix validé » cochée par défaut).
- **Étapes** (vérifié en local) :
  1. Gérant : `POST /api/gestion/carte` avec `{"type":"plat","slug":"pizza-margherita","champs":{"prix":1.8,"prix_valide":false}}`. Réponse : `{"enregistre":true}`.
  2. `POST /api/panier` avec une Margherita : total CHF 1.80, `valide: true`, `prix_a_valider: true`.
- **Attendu** : la règle du projet, « tant qu'un plat commandable a `prix_a_valider = true`, pas de mise en production ».
- **Observé** : avant le lancement, le build garde ce verrou. Après, le plat se vend au prix non validé, et le prochain build de production échoue au `prebuild` (vue `plats_bloquants` non vide), même pour un correctif urgent, tant que personne n'a revalidé. À l'inverse, par l'écran, la case cochée par défaut valide d'office une faute de frappe.
- **Correction proposée** : au lancement, étendre le déclencheur à tous les plats (un prix à valider retire le plat de la vente), et décocher la case quand le prix change. Choix de fonctionnement, donc pas fait.
- **Effort** : petit.

<a id="s2-03"></a>
### S2-03. Un remboursement qui échoue après coup chez Stripe n'est jamais vu

- **Gravité** : important avant d'activer TWINT en production.
- **Où** : `src/lib/paiement/passerelle.ts:89` à `:95` (seul l'identifiant du remboursement est rendu, pas son état), `src/lib/commandes.ts:122` et `:225` (« fait » dès la création), `src/app/api/stripe/webhook/route.ts:28` (seuls les événements `checkout.session.*` sont traités).
- **Étapes** (lu dans le code) : Stripe accepte la demande avec l'état `pending`, puis le remboursement passe `failed` (rare pour une carte, possible pour un moyen local).
- **Observé** : la commande est « remboursée », le client a reçu l'e-mail, l'export de la fiduciaire compte le remboursement, personne n'est alerté.
- **Correction** : garder `en_cours` tant que `refund.status` n'est pas `succeeded`, traiter `charge.refund.updated` dans le webhook (événement à ajouter chez Stripe) et alerter le restaurant sur `failed`. À vérifier en mode test avec la carte Stripe de remboursement en échec différé.
- **Effort** : moyen.

<a id="s2-04"></a>
### S2-04. Second remboursement après une réponse ambiguë de Stripe

- **Gravité** : important.
- **Où** : `src/app/api/gestion/commandes/route.ts:50` (`409` pour tout échec), `src/lib/commandes.ts:229` (« encore en cours chez Stripe »), `src/components/gestion/GestionCommandes.tsx:274` (clé neuve sur un `409`, montant et motif gardés).
- **Étapes** (lu dans le code) : délai ou coupure réseau vers Stripe pendant un remboursement après coup. La ligne reste `en_cours`, la route répond `409`, la fiche tire une nouvelle clé. Le gérant reclique « Rembourser » : nouvelle ligne, nouvelle clé d'idempotence, second remboursement chez Stripe.
- **Observé** : le plafond en base compte les lignes `en_cours`, donc le total payé n'est jamais dépassé, mais 20 CHF sur une commande de 80 peuvent sortir deux fois. Le commentaire de la fiche dit l'inverse de ce que fait le code.
- **Correction (faite)** : la route répond `503` pour ce cas, que la fiche traite comme une coupure : elle garde sa clé, et le même formulaire reprend le même remboursement.
- **Effort** : petit.

<a id="s2-05"></a>
### S2-05. « Compris » accepté sur la livraison d'un autre livreur

- **Gravité** : confort. L'état de la commande ne change pas.
- **Où** : `supabase/migrations/20261119090000_livreurs.sql:434` à `:444`.
- **Étapes** (vérifié en local) : Inès envoie `{"geste":"compris"}` pour une livraison attribuée à Marco. Réponse : `{"ok":true}`, et le journal de livraison de cette commande porte une ligne à son nom.
- **Correction (faite)** : « ok » seulement si la livraison est à ce livreur ; un second « compris » avec une autre clé répond « ok » sans nouvelle ligne.
- **Effort** : petit.

<a id="s2-06"></a>
### S2-06. Gestes acceptés après « Livrée », interblocage avec la tablette

- **Gravité** : confort.
- **Où** : `20261119090000_livreurs.sql:460` à `:486` (la branche « problème » ne contrôle pas le statut), `:446` et `:447` (livraison verrouillée avant la commande, alors que `attribuer_livraison` et `clore_client_absent` font l'inverse).
- **Étapes** (vérifié en local) : Marco touche « Livrée », puis envoie « Problème : client absent » sur la même commande. Réponse : `{"ok":true}`, motif écrit sur une livraison close. Un « Livrée » rejoué avec une clé neuve ajoute une ligne au journal.
- **Observé** : rien ne s'affiche sur la tablette, mais l'exigence « aucun geste sur une commande close » n'est pas tenue. Une réattribution au moment où le livreur appuie sur « Livrée » peut finir en erreur 40P01 (une des deux requêtes échoue).
- **Correction (faite)** : problème refusé hors d'une livraison en cours, gestes sans effet non journalisés, commande verrouillée avant la livraison.
- **Effort** : petit.

<a id="s2-07"></a>
### S2-07. Un gérant retiré pendant son propre geste le termine quand même

- **Gravité** : confort.
- **Où** : `20261119090000_livreurs.sql:56` (`gerant_nom` lu avant le verrou) puis `:62` (verrou).
- **Étapes** (lu dans le code ; PGlite n'a qu'une connexion, la course ne se rejoue pas en local) : A retire B au moment où B nomme gérant un tiers. L'appel de B attend la fin de celui de A, puis passe.
- **Correction (faite)** : `gerant_nom` rappelée après le verrou.
- **Effort** : petit.

<a id="s2-08"></a>
### S2-08. Vues publiques avec les droits d'écriture par défaut

- **Gravité** : confort. Sans effet aujourd'hui : les vues sont en `security_invoker`, les droits des tables s'appliquent et les visiteurs n'y écrivent pas.
- **Où** : `carte_publique`, `options_publiques`, `plat_groupes_publics`, `retraits_publics`. Le correctif S8 (`20261112090000_correctifs_securite.sql:105`) ne citait que les tables.
- **Étapes** (vérifié dans le catalogue) : `anon` a `INSERT`, `UPDATE`, `DELETE` et `TRUNCATE` sur ces quatre vues.
- **Correction (faite)** : tout retiré sauf la lecture.
- **Effort** : petit.

<a id="s2-09"></a>
### S2-09. Le build de production ne voit pas tous les restes de test

- **Gravité** : important au lancement.
- **Où** : `scripts/verifier-mise-en-ligne.ts:24` à `:29` (personnel `.test`, imprimantes de test, commandes de préversion).
- **Observé** (lu dans le code) : les préversions écrivent dans la vraie base. Un plat ou un plat du jour ajouté au back-office pendant la construction (un plat du jour n'a pas de prix à valider), une photo d'essai ou un compte client de test resteraient en ligne. Exemple : un « plat du jour test » à CHF 1 saisi pour dans dix jours serait en vente au lancement.
- **Correction (faite, procédure)** : ligne ajoutée à la phase 4 de `docs/mise-en-ligne.md` avec la requête à lancer. Un contrôle automatique reste possible, mais il faudrait deviner ce qui est un essai.
- **Effort** : petit.

<a id="s2-10"></a>
### S2-10. Plat du jour à CHF 0 vendu tout de suite

- **Gravité** : confort.
- **Où** : `src/lib/gestion.ts:16` (accepte 0), `carte_gestion.sql:631` (plat du jour né validé, décision de Jérémy).
- **Étapes** (vérifié en local) : plat du jour du jour à `prix: 0`, commandable : `{"enregistre":true,"commandable":true}`.
- **Observé** : une faute de frappe (0 ou 1.8 au lieu de 18) met le plat en vente aussitôt, gratuit au comptoir. Aucun plat ordinaire ne peut passer par ce chemin.
- **Correction proposée** : refuser un prix de plat à 0. Choix de Jérémy (un plancher plus haut, par exemple CHF 5, attraperait aussi « 1.8 »).
- **Effort** : petit.

<a id="s2-11"></a>
### S2-11. Photos : cache contourné, photo retirée gardée en cache

- **Gravité** : confort.
- **Où** : `src/app/photos/[fichier]/route.ts`.
- **Observé** :
  - Chaque `?x=1`, `?x=2`… sur une photo existante a sa propre place dans le cache du CDN (supposé, clé de cache de Netlify) et relit la photo en base, jusqu'à 3 Mo en base64 par appel. Une boucle anonyme fait monter le trafic sortant de Supabase.
  - Une photo retirée répond 404 côté serveur (vérifié), mais l'adresse déjà servie reste un an dans les caches (`immutable`). Le risque : une photo envoyée par erreur (un ticket avec le nom d'un client).
  - Le `Content-Security-Policy: default-src 'none'` de la route est remplacé par celui du site (`frame-ancestors 'none'`). Sans conséquence : le fichier est un JPEG réencodé, servi avec `nosniff`.
- **Correction (faite)** : 404 dès qu'il y a des paramètres, sans lire la base. Pour une photo envoyée par erreur : la retirer, puis vider le cache du site dans Netlify (Deploys, « Clear cache and deploy site »).
- **Effort** : petit.

<a id="s2-12"></a>
### S2-12. Sauvegardes et GitHub Actions

- **Gravité** : confort. La sauvegarde n'est pas encore branchée (aucun secret Actions posé).
- **Observé** :
  1. Si la restauration d'essai échoue sur une ligne, `psql` écrit dans le journal Actions (lisible par tout lecteur du dépôt, 90 jours) des détails comme `DETAIL: Key (email)=(…)`. Contraire à `docs/sauvegardes.md:39`. **Corrigé** : `VERBOSITY=terse` dans `restaurer-copie.sh`.
  2. `actions/checkout` gardait le jeton GitHub dans `.git/config` pendant `npm ci` et les scripts. **Corrigé** : `persist-credentials: false` (aucun workflow ne pousse).
  3. `.gitignore` ne couvrait ni les copies (`*.dump`, `*.dump.age`, `*.empreinte.txt`) ni la clé de sauvegarde. **Corrigé**.
  4. `scripts/exploitation/restaurer.sh:9` et `docs/sauvegardes.md:104` passent l'URL de la base avec son mot de passe en argument : il reste dans l'historique du terminal et se voit dans `ps`. Pas fait : à changer avec la session « filet » (lecture par `read -s` ou `PGPASSWORD`), la procédure n'ayant pas encore été jouée.
  5. Réglages du dépôt : toutes les actions permises et l'épinglage par SHA non exigé, alors que les fichiers épinglent déjà tout. À régler par Jérémy dans GitHub (Settings, Actions, General : « Allow actions created by GitHub » et « Require actions to be pinned to a full-length commit SHA »).
  6. Le secret `SUPABASE_URL_SAUVEGARDE` (lecture de toutes les données) est lisible par un workflow poussé sur n'importe quelle branche. Les environnements protégés limités à `main` demandent GitHub Pro sur un dépôt privé. À noter avec la protection de branche dans `docs/filet.md`.
- **Effort** : petit.

<a id="s2-13"></a>
### S2-13. Manque d'un supplément remboursé au prix actuel de l'option

- **Gravité** : confort. Le total de la commande borne toujours le montant.
- **Où** : `supabase/migrations/20261117090000_gerant_vague2.sql:127` à `:150` ; `commande_lignes` ne garde pas le prix des options au moment de la commande.
- **Étapes** (lu dans le code) : supplément à CHF 3 au moment de la commande, passé à CHF 8 ensuite. Manque signalé sur une ligne de 4 plats : CHF 32 remboursés au lieu de 12.
- **Correction** : plafonner par le total de la ligne moins ce qui en a déjà été rendu, ou mieux, figer le prix des options dans `choix` à la commande. `signaler_manque` est un objet partagé : à faire avec la session du gérant.
- **Effort** : petit.

<a id="s2-14"></a>
### S2-14. Adresse du client dans l'URL d'itinéraire

- **Gravité** : décision de Jérémy.
- **Où** : `src/lib/navigation.ts:7` à `:10`, `src/components/livreur/Livreur.tsx:303`.
- **Observé** (lu dans le code) : le lien « Itinéraire » envoie rue, numéro, NPA et localité en paramètre à Apple Plans ou Google Maps. Ni nom, ni téléphone, ni code d'entrée. C'est voulu, mais contraire à la règle « données client jamais dans une URL ».
- **Correction proposée** : garder le lien et écrire l'exception dans `CLAUDE.md` (l'adresse part chez le service de cartes du livreur, pas dans un outil d'analyse).

<a id="s2-15"></a>
### S2-15. Téléphone du livreur

- **Gravité** : confort.
- **Où** : `src/lib/personnel/session.ts:19` (60 jours pour tous les rôles), `src/components/livreur/Livreur.tsx:20` et `:147` (gestes en attente dans le `localStorage`).
- **Observé** (lu dans le code) : un téléphone personnel perdu garde l'accès 60 jours, limité aux livraisons en cours du livreur. Après « Déconnexion », les gestes pas encore envoyés restent dans le téléphone, avec le mot libre d'un problème (qui peut nommer le client).
- **Correction proposée** : session de 12 heures pour le rôle livreur (choix de Jérémy). Envoyer les gestes en attente avant la déconnexion, puis les effacer (avec la session des livreurs : un « Livrée » non envoyé ne doit pas se perdre).

<a id="s2-16"></a>
### S2-16. E-mail d'un nouveau membre pas normalisé comme à la connexion

- **Gravité** : confort.
- **Où** : `src/app/api/gestion/personnel/route.ts:45`.
- **Observé** (lu dans le code) : la base ne retire que les espaces simples, la connexion retire aussi les espaces insécables. Une adresse collée avec une espace insécable créait un membre que personne ne peut joindre. Aucun contournement du blocage à 15 essais.
- **Correction (faite)** : `emailNormalise` dans la route.

<a id="s2-17"></a>
### S2-17. `/api/diagnostic/images` ouverte sur les préversions

- **Gravité** : confort.
- **Où** : `src/app/api/diagnostic/images/route.ts:9`.
- **Observé** (lu dans le code) : sans session, chaque appel fait travailler sharp sur une image de 3000 × 2000 et renvoie jusqu'à 1500 caractères d'erreur interne. Fermée en production (404).
- **Correction** : la retirer une fois l'envoi de photos vérifié sur Netlify, au plus tard au lancement.

## Non retenu après vérification

- **Bombe de décompression** : refusée avant décodage (`limitInputPixels`), vérifié avec 900 Mpx.
- **Photo d'un autre plat posée sur un plat** : refusée par `modifier_plat` (`photo_inconnue`).
- **Double premier ticket d'une commande à l'avance** : `tickets_le` sous verrou.
- **`/api/sante` dit quand la tablette est muette** : information d'exploitation sans donnée personnelle, rien d'exploitable.
- **Livreur sur `/tablette` ou `/gestion`** : 403 sur toutes les routes, la page ne montre que la connexion.

## Ce que je n'ai pas pu vérifier

- Les courses entre deux connexions Postgres (S2-06 interblocage, S2-07) : PGlite n'a qu'une connexion. Lu dans le code.
- L'effet réel du cache de Netlify sur `/photos?x=` (S2-11) : il faudrait une photo dans la vraie base.
- Le comportement de Stripe sur un remboursement en échec différé (S2-03) : pas de clé Stripe de test dans cette session.

## Méthode

Droits SQL relevés sur une base neuve qui rejoue `supabase/local/roles.sql`, toutes les migrations et `seed.sql` :

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;            -- 0 ligne
select table_name, grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') group by 1, 2;
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));                  -- maj_modifie_le seulement
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;                                        -- 0 ligne
```
