# Audit de sécurité, site de commande La Ferme

Audit du 12.11.2026, sur `main` au commit `d95375f` (PR #18 comprise). Revue de tout le dépôt (code, 10 migrations SQL, scripts, configuration Netlify), avec le skill `security-review` appliqué à l'ensemble et non à un diff. Les constats du sous-agent de revue ont été filtrés par une preuve en local : seul ce qui a été reproduit, ou qui se lit sans ambiguïté dans le code, est retenu.

Terrain :

- attaques actives sur une instance locale (`BASE_LOCALE=1 npm run build`, `next start -p 3103`, base embarquée PGlite) ;
- sur la préversion https://deploy-preview-18--boisterous-beijinho-c37e44.netlify.app, des contrôles passifs seulement : en-têtes, `robots.txt`, pages fermées, un essai d'en-tête `X-Forwarded-Host` avec un e-mail invalide (rien n'est écrit) ;
- sur l'API REST Supabase de production avec la clé publiable : lectures seulement. Les essais d'écriture sans effet et les appels de fonctions ont été refusés par le garde-fou de la session. Ils ont été faits sur la base locale, qui rejoue les mêmes migrations.

Marquage : **vérifié** = reproduit ou lu en direct. **Lu dans le code** = certain à la lecture, pas rejoué. **Supposé** = dépend d'un réglage que je n'ai pas pu voir.

## Les 10 constats les plus importants

| # | Constat | Gravité | Effort |
|---|---|---|---|
| [S1](#s1) | Sur une préversion, n'importe qui devient gérant de la base de production (code affiché à l'écran pour `equipe@laferme.test`) | bloquant avant lancement | petit |
| [S2](#s2) | Sur une préversion, n'importe qui crée des commandes « payées » sans payer, dans la base de production | bloquant avant lancement | petit |
| [S3](#s3) | Les imprimantes de test recevraient les vrais tickets si elles restent en base, et le build de production ne contrôle aucun reste de test | bloquant avant lancement | petit |
| [S4](#s4) | Force brute du code à 6 chiffres : 600 essais par jour sur un compte, environ 20 % de chances par an | important | petit |
| [S5](#s5) | Commandes « au comptoir » non payées sans aucune limite : 5 commandes de 40 pizzas en une seconde | important | moyen |
| [S6](#s6) | Sans `SECRET_COMPTES`, une session ouverte sur une préversion vaut en production | important | petit |
| [S7](#s7) | Un build fait hors de Netlify se croit « local » : limites par IP contournables, cookies sans `Secure`, heure simulée | important | petit |
| [S8](#s8) | Les tables publiques gardent pour `anon` les droits d'écriture par défaut de Supabase, seule la sécurité par ligne les bloque | confort | petit |
| [S9](#s9) | En-têtes de sécurité absents (CSP, `frame-ancestors`, `Referrer-Policy`) | confort | petit |
| [S10](#s10) | `/api/surveillance` sans secret, déclenchable depuis une préversion sur la base de production | confort | petit |

Les autres constats (S11 à S13) sont en fin de liste.

## Ce qui marche bien (vérifié)

| Domaine | Ce qui tient | Preuve |
|---|---|---|
| Données d'un autre client | « Recommander » la commande d'un autre compte renvoie « Commande inconnue ». Espace client, export, adresses et suppression prennent l'identifiant de la session, jamais celui de la requête. Jeton de suivi inventé : 404. | essais locaux, `lignes_commande_compte` (`20261108090000_comptes.sql`) |
| Sécurité par ligne | Les 19 tables privées (commandes, comptes, sessions, personnel, imprimantes, journaux, courriels…) refusent `anon` et `authenticated` en lecture et en écriture. Les 61 fonctions SQL sont en `security invoker`, aucune n'a de SQL dynamique, 60 ont l'exécution retirée à `public`, `anon` et `authenticated` (la 61e est un déclencheur). | base locale rôle par rôle ; sur la vraie base, 19 tables privées et la vue `plats_bloquants` répondent `42501 permission denied` à la clé publiable |
| Prix et options | Quantité négative ou décimale, option d'un autre plat, option inconnue : refusées. Le prix vient de la base. Un nouvel essai avec la même clé facture la commande déjà enregistrée. | essais locaux sur `/api/commandes` |
| Zone | Une adresse tapée à la main doit être retrouvée à l'identique dans le registre fédéral, sinon refus. Le NPA ne suffit pas au paiement. `featureId` filtré par regex, hôte geo.admin.ch fixe : pas de SSRF. | essai local (adresse inventée à Onex refusée), `zone-serveur.ts:23`, `adresse-serveur.ts:10` |
| Heure simulée | `?heure` n'est lu que hors production (`CONTEXTE_DEPLOIEMENT` figé au build). | `api/commandes/route.ts:69`, `api/panier/route.ts:37`, `api/accueil/route.ts:18` (voir S7 pour la limite) |
| Connexion par code | Code par `crypto.randomInt`, gardé en empreinte HMAC, comparé en temps constant. Cinq essais faux et le code est annulé (le bon code est refusé ensuite). Cinq codes par heure et par e-mail, même avec une autre IP. Même réponse que le compte existe ou non. | script local de force brute |
| Session | Jeton de 32 octets neuf à chaque connexion, cookie `HttpOnly`, `SameSite=Lax` (client) ou `Strict` (personnel), préfixe `__Host-` hors poste local. « Déconnecter tous mes appareils » rend l'ancien cookie inutilisable. | essais locaux, `comptes/session.ts:16`, `personnel/session.ts:20` |
| CSRF | Tout POST qui change un état exige l'en-tête `Origin` du site ou `Sec-Fetch-Site: same-origin`. Sans Origin ou avec un Origin étranger : « Requête refusée ». | essais locaux |
| En-tête d'hôte | Sur la préversion, un `X-Forwarded-Host` forgé est ignoré par Netlify (« Requête refusée »). En production, l'origine vient de `URL_SITE` seulement. | essai sur la préversion, `origine.ts:7` |
| Rôles | Rôle gérant contrôlé dans la route puis de nouveau en base (`gerant_nom` dans chaque fonction d'écriture). | `personnel/session.ts:60`, `20261110090000_gestion.sql` |
| Paiement | Webhook signé sur le corps brut. Chaque événement n'est appliqué qu'une fois. Confirmation seulement pour la session en cours, en CHF, au montant exact. Remboursement idempotent. Clé live refusée hors production. Doublure fermée en production. | `stripe/webhook/route.ts:17`, `commandes.ts:30`, `passerelle.ts:41` |
| XSS et injection | Noms, notes et adresses piégés (`<img onerror>`, `=HYPERLINK(…)`) enregistrés tels quels puis affichés par React (échappé), échappés dans les courriels et dans le SVG des tickets. Seul `dangerouslySetInnerHTML` : le JSON-LD de l'accueil, sans donnée client. Le CSV des ventes ne contient aucune saisie client et neutralise les formules. | `courriel/modeles.ts:13`, `impression/ticket.ts:138`, `gestion.ts:194` |
| Imprimantes | Jeton de 32 octets gardé en empreinte, adresse MAC liée au premier passage, une imprimante ne lit que ses propres tâches. | `20261111090000_impression.sql:64` à `145` |
| Cache | Accueil, carte et panier sont en cache mais ne lisent aucun cookie. `/compte`, `/tablette`, `/gestion` et les routes du compte répondent `private, no-store`. | en-têtes de la préversion |
| Secrets | Aucune clé dans le dépôt ni dans ses 87 commits (seulement `sk_test_factice` et `whsec_factice` dans les tests). `.env*` ignoré. | scan de `git log --all -p` |
| Journaux | Aucun e-mail, téléphone, adresse, code ni jeton dans les `console.error`. Le journal des connexions garde 8 caractères de l'empreinte de l'IP. | grep de `src/` |
| Pages fermées | `/dev/courriels` exige un jeton de suivi (404 sans), `/api/diagnostic/latence` et `/paiement-test` répondent 404 en production, `robots.txt` interdit tout sur la préversion, `x-robots-tag: noindex`. | préversion et code |

## Constats détaillés

<a id="s1"></a>
### S1. Sur une préversion, n'importe qui devient gérant de la base de production

- **Gravité** : bloquant avant lancement. Le risque est déjà là, pas seulement au lancement.
- **Où** : `supabase/migrations/20261109090000_tablette.sql:91` (le compte `equipe@laferme.test` est créé avec le rôle `gerant` par la migration, donc dans la vraie base), `src/lib/personnel/connexion.ts:13` et `:26`, `src/app/api/personnel/code/route.ts:17` (code renvoyé au navigateur).
- **Étapes** (vérifié en local, mêmes conditions que la préversion : pas de Resend, contexte non production) :
  1. `POST /api/personnel/code` avec `{"email":"equipe@laferme.test"}` et l'en-tête `Origin` du site. Réponse : `{"envoye":true,"codePreversion":"298541"}`.
  2. `POST /api/personnel/connexion` avec ce code. Réponse : `{"connecte":true}` et le cookie de session du personnel, valable 60 jours.
  3. `POST /api/gestion/carte` avec `{"type":"plat","slug":"pizza-margherita","champs":{"prix":0.5,"prix_valide":true,"allergenes":"Aucun"}}`. Réponse : `{"enregistre":true}`. Le panier affiche ensuite la Margherita à CHF 0.50, prix marqué validé.
- **Attendu** : seule l'équipe du restaurant accède à `/tablette` et `/gestion`.
- **Observé** : sur la préversion, le même parcours marche pour qui connaît l'URL. Elle a une forme prévisible (`deploy-preview-<numéro de PR>--boisterous-beijinho-c37e44.netlify.app`). Je ne l'ai pas rejoué sur la préversion, parce que demander un code y écrit dans la vraie base. Le code affiché à l'écran sur la préversion a déjà été constaté le 8.11.2026 pendant le lot 8f. `docs/tablette.md:40` confirme que le compte est en base de production.
- **Impact** :
  - Changer et **valider** les prix, les allergènes et la disponibilité de n'importe quel plat. Cela vide la vue `plats_bloquants`, le seul verrou du build de production, sans Jérémy.
  - Changer zones, frais, minimums, horaires, fermetures, mettre les commandes en pause.
  - Ajouter une imprimante, désactiver les autres, et recevoir les tickets (nom, téléphone, adresse, code de porte).
  - Lire la file de la tablette, avec les coordonnées des clients, dès que de vraies commandes existent. La recette en service fictif (phase 3) en crée.
- **Correction** :
  1. Tout de suite, sans attendre la bascule : supprimer ce membre de la vraie base, ou le passer en rôle `service`. Ensuite, déplacer l'`insert` de la migration vers `supabase/local/donnees-test.sql`.
  2. Dans `demanderCodePersonnel` et `demanderCode` : ne jamais renvoyer `codePreversion` quand le serveur a une clé Supabase, c'est-à-dire quand `ecritureDisponible()` vise un vrai projet. Garder le code à l'écran pour la base embarquée seulement.
  3. Le jour de la bascule, relire `journal_gestion` : toute modification faite par « Équipe test » doit être expliquée avant le build de production.
- **Effort** : petit.

<a id="s2"></a>
### S2. Sur une préversion, n'importe qui crée des commandes « payées » sans payer

- **Gravité** : bloquant avant lancement.
- **Où** : `src/app/api/paiement-test/route.ts:9`, `src/lib/paiement/passerelle.ts:112` (doublure active dès qu'il n'y a pas de clé Stripe hors production).
- **Étapes** (vérifié en local) :
  1. `POST /api/commandes` en ligne, 3 Pizzas miss Italia. Réponse : redirection vers `/paiement-test/<id>`.
  2. `POST /api/paiement-test` avec `{"commande":"<id>","issue":"paye"}`. Réponse : redirection vers le suivi.
  3. La file de la tablette montre la commande `nouvelle`, `paye`, CHF 84.00.
- **Attendu** : une commande payée l'est chez Stripe.
- **Observé** : sur une préversion branchée sur la vraie base, la commande « payée » arrive dans la base de production. Après le lancement, elle sonnerait sur la vraie tablette et s'imprimerait au poste pizza. Une fois `sk_test_` posée sur les préversions (prévu en phase 1), la carte de test Stripe 4242 donne le même résultat, par le webhook de test ou la réconciliation.
- **Impact** : pizzas préparées pour personne, file de la tablette polluée, chiffre d'affaires faussé dans l'export de la fiduciaire.
- **Correction** :
  1. Retirer `SUPABASE_SECRET_KEY` des contextes Deploy Previews et Branch deploys dès que la base de production contient autre chose que des tests, au plus tard avant la recette. C'est déjà dans `docs/mise-en-ligne.md` (phase 2), mais à faire avant la phase 3, pas à la bascule.
  2. Dans le code : refuser la doublure et une clé Stripe de test quand le serveur écrit dans un vrai projet Supabase hors production, sauf variable explicite `BASE_DE_TEST=1` posée avec un projet de test.
- **Effort** : petit.

<a id="s3"></a>
### S3. Restes de test : les imprimantes de test recevraient les vrais tickets

- **Gravité** : bloquant avant lancement.
- **Où** : `supabase/migrations/20261111090000_impression.sql:150` (`creer_taches_impression` envoie chaque ticket à la première imprimante active du poste, par identifiant croissant), `scripts/verifier-mise-en-ligne.ts:19` (seul `plats_bloquants` est contrôlé).
- **Étapes** (lu dans le code) : les imprimantes « Test pizza (préversion) » et « Test cuisine (préversion) » ont été créées avant les vraies. Elles ont donc un identifiant plus petit. Si elles restent actives, chaque ticket accepté part vers elles et jamais vers l'imprimante du restaurant.
- **Attendu** : le build de production refuse de partir tant qu'il reste des données de test.
- **Observé** : la liste de bascule prévoit de les supprimer à la main, mais aucun contrôle automatique ne l'impose. Même chose pour le personnel `.test`, les commandes de test et `SECRET_COMPTES` (S6).
- **Impact** : tickets perdus le premier soir. Si le jeton d'une imprimante de test a circulé (il a été affiché à sa création pendant le lot 7c), les coordonnées des clients partent chez son détenteur.
- **Correction** : ajouter à `verifier-mise-en-ligne.ts` un échec du build s'il reste un membre `personnel` en `.test`, une imprimante dont le nom contient « préversion » ou « test », une commande antérieure à la date de bascule, ou si `SECRET_COMPTES` manque.
- **Effort** : petit.

<a id="s4"></a>
### S4. Force brute du code à 6 chiffres

- **Gravité** : important. Le compte gérant est concerné comme les comptes clients.
- **Où** : `supabase/migrations/20261108090000_comptes.sql:193` (5 codes par heure et par e-mail), `:226` (essais faux par IP), `:244` (5 essais par code) ; mêmes règles pour le personnel dans `20261109090000_tablette.sql:107` et `:140`. `src/lib/comptes/securite.ts:38` (une adresse IPv6 compte entière).
- **Étapes** (vérifié en local, en changeant d'IP à chaque requête) : code 1 accepté, code 2 refusé 30 s même depuis une autre IP. Cinq faux codes depuis cinq IP, puis le bon code est refusé (code annulé). Les limites tiennent donc par e-mail.
- **Attendu** : un attaquant patient ne finit pas par entrer.
- **Observé** (calcul à partir des limites vérifiées) : 5 codes par heure × 5 essais = 25 essais par heure et 600 par jour sur un même e-mail, sans plafond sur la journée. Chances : 0,06 % par jour, environ 1,8 % par mois, environ 20 % par an. Il faut 3 à 4 IP pour rester sous la limite par IP, ou un seul abonnement IPv6 (un /64 donne des milliards d'adresses).
- **Impact** : un compte gérant visé sur des mois peut tomber. La victime reçoit jusqu'à 120 e-mails de code par jour, ce qui se remarque.
- **Correction** :
  1. Au-delà de 15 essais faux en 24 h sur un e-mail, bloquer cet e-mail 24 h. Prévenir `ALERTE_EMAIL` si c'est un membre du personnel.
  2. Dans `ipDe`, regrouper les IPv6 par /64.
  3. Pour le personnel, un code de 8 chiffres.
- **Effort** : petit.

<a id="s5"></a>
### S5. Commandes « au comptoir » non payées sans limite

- **Gravité** : important.
- **Où** : `src/app/api/commandes/route.ts:126` (commande au comptoir confirmée et envoyée à la tablette tout de suite, sans aucun contrôle de volume).
- **Étapes** (vérifié en local) : cinq `POST /api/commandes` de suite, même IP, retrait au comptoir, 20 Pizzas miss Italia et 20 Pizzas prosciutto chacune, faux noms. Les cinq répondent 200.
- **Attendu** : un farceur ne peut pas remplir la tablette de commandes impayées.
- **Observé** : aucune limite par IP, par téléphone ni par e-mail, aucun plafond de montant au comptoir.
- **Impact** : la personne au comptoir doit trier à la main. Si elle accepte sans appeler, les deux postes impriment et préparent. Un samedi soir, cela bloque le four.
- **Correction** :
  1. Au plus 2 commandes au comptoir pas encore retirées par téléphone et par e-mail, et 5 par IP et par heure.
  2. Au-delà de CHF 120 (montant à fixer par Jérémy), paiement en ligne obligatoire.
  3. Sur la tablette, un repère « premier passage de ce numéro ».
- **Effort** : moyen.

<a id="s6"></a>
### S6. Sans `SECRET_COMPTES`, une session ouverte sur une préversion vaut en production

- **Gravité** : important.
- **Où** : `src/lib/comptes/securite.ts:10` (clé HMAC tirée de `SUPABASE_SECRET_KEY` à défaut), `docs/comptes.md:42` (dit « facultatif »), contre `docs/mise-en-ligne.md` (dit « oui » en production).
- **Étapes** (lu dans le code) : tant que la préversion et la production ont la même `SUPABASE_SECRET_KEY` et pas de `SECRET_COMPTES`, l'empreinte d'un jeton est la même des deux côtés. Un jeton obtenu sur une préversion (S1) puis recopié dans un cookie du domaine de production ouvre la même session.
- **Attendu** : la production a sa propre clé.
- **Observé** : rien n'oblige à la poser. Changer cette clé après le lancement déconnecte tout le monde.
- **Correction** : rendre `SECRET_COMPTES` obligatoire en production (`cleHmac` lève une erreur sans elle, et le build échoue, S3). Corriger `docs/comptes.md`. La poser avant le premier vrai client.
- **Effort** : petit.

<a id="s7"></a>
### S7. Un build fait hors de Netlify se croit « local »

- **Gravité** : important (seulement si le déploiement de production ne passe pas par le build Netlify).
- **Où** : `next.config.ts:20` (`CONTEXTE_DEPLOIEMENT` vaut `local` sans la variable `CONTEXT`), `src/lib/comptes/securite.ts:43` (en local, l'IP est la première valeur de `X-Forwarded-For`, choisie par le client), `src/lib/comptes/session.ts:17` et `:23` (cookie sans `Secure` ni `__Host-`).
- **Étapes** (lu dans le code ; en local, `X-Forwarded-For` a servi à simuler des IP dans S4) : un `npm run build` sur le poste puis `netlify deploy --prod --dir .next` publie un site où `CONTEXTE_DEPLOIEMENT` vaut `local`.
- **Impact** : limites par IP contournables par un simple en-tête, cookies de session sans `Secure`, `?heure` actif, `/api/diagnostic/latence` et `/dev/courriels` ouverts.
- **Correction** : déployer la production seulement par le build Netlify (point de bascule). Dans le code, refuser de démarrer quand `CONTEXTE_DEPLOIEMENT` vaut `local` alors que l'exécution tourne sur Netlify (variable `NETLIFY` ou `SITE_ID` présente).
- **Effort** : petit.

<a id="s8"></a>
### S8. Droits d'écriture par défaut d'`anon` sur les tables publiques

- **Gravité** : confort (défense en profondeur).
- **Où** : `supabase/migrations/20261105120000_carte.sql:92` à `106`, `20261106120000_zones_horaires.sql:53` à `66`. Les tables `categories`, `plats`, `options`, `groupes_options`, `plat_groupes`, `plat_retraits`, `zones_livraison`, `zone_npa`, `horaires`, `fermetures`, `reglages` gardent `insert`, `update`, `delete` pour `anon` et `authenticated` (droits par défaut de Supabase).
- **Étapes** (vérifié sur la base locale avec les rôles Supabase recréés) : un `insert` d'`anon` est arrêté par la sécurité par ligne, un `delete` passe mais n'atteint aucune ligne faute de politique. Rien n'est modifiable aujourd'hui.
- **Risque** : une politique ajoutée un jour avec `for all` au lieu de `for select` ouvrirait l'écriture de la carte et des prix à tout le monde.
- **Correction** : migration `revoke insert, update, delete, truncate on <ces tables> from anon, authenticated;`.
- **Effort** : petit.

<a id="s9"></a>
### S9. En-têtes de sécurité absents

- **Gravité** : confort.
- **Où** : `next.config.ts:14` (seul l'en-tête du manifeste), `netlify.toml`.
- **Observé** (vérifié sur la préversion) : `strict-transport-security` et `x-content-type-options` viennent de Netlify. Il manque `Content-Security-Policy`, `frame-ancestors` (ou `X-Frame-Options`), `Referrer-Policy` et `Permissions-Policy`. `X-Powered-By: Next.js` est envoyé.
- **Impact limité** : les cookies `SameSite` ne partent pas dans un cadre d'un autre site, donc `/tablette` et `/gestion` encadrées s'affichent déconnectées. Une CSP limiterait pourtant les dégâts d'une future faille XSS.
- **Correction** : dans `next.config.ts`, `poweredByHeader: false`, puis pour toutes les pages `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, une CSP qui autorise `self`, Stripe (`checkout.stripe.com`), Supabase Realtime (`wss://*.supabase.co`) et `api3.geo.admin.ch`. À tester sur la préversion avant de fusionner.
- **Effort** : petit.

<a id="s10"></a>
### S10. `/api/surveillance` sans secret

- **Gravité** : confort.
- **Où** : `src/app/api/surveillance/route.ts:7`, `src/lib/surveillance.ts:62`.
- **Étapes** (lu dans le code) : `POST /api/surveillance` sur une préversion lance un tour de surveillance sur la base de production. Pendant les heures de service, tant que la tablette n'est pas allumée (avant le lancement), cela met les commandes en ligne en pause sans fin et écrit une alerte.
- **Impact** : aujourd'hui nul (rien n'est en ligne). Après le lancement, la tablette vit et la production fait le même tour chaque minute. Le défaut reste une porte d'écriture anonyme sur la base de production depuis chaque préversion.
- **Correction** : exiger un secret partagé entre la fonction planifiée et la route (`Authorization: Bearer <SURVEILLANCE_SECRET>`). Les passages d'imprimante et de tablette appellent déjà `surveillanceAuPassage` sans passer par la route.
- **Effort** : petit.

<a id="s11"></a>
### S11. Énumération du personnel par le temps de réponse

- **Gravité** : confort.
- **Où** : `src/lib/personnel/connexion.ts:24` (adresse inconnue : réponse sans appel à Resend ; adresse de l'équipe : réponse après l'envoi).
- **Observé** : supposé, non mesuré (pas de Resend en local). La réponse est la même, mais le délai diffère de la durée d'un appel à Resend. Cela aide à trouver l'e-mail du gérant avant une force brute (S4).
- **Correction** : envoyer l'e-mail après la réponse (`waitUntil` de Netlify ou `after()` de Next) dans les deux cas.
- **Effort** : petit.

<a id="s12"></a>
### S12. Dépendances (`npm audit`)

- **Gravité** : confort.
- **Observé** (vérifié) : 1 haute, 8 moyennes.
  - `postcss` ≤ 8.5.22 par `next` 15.5.29 (XSS dans la sortie CSS, lecture de fichier par `sourceMappingURL`) : sert au build sur notre propre CSS, aucun CSS venu d'un client. Non exploitable ici.
  - `fflate` 0.8.2 (boucle infinie sur un ZIP64 malformé) : utilisé par l'import xlsx, réservé au gérant. Un gérant pourrait bloquer une fonction.
  - Le reste concerne ESLint (outils de développement).
- **Correction** : `fflate` en 0.8.3. Suivre les correctifs de Next 15.5 sans passer à Next 16 avant le lancement.
- **Effort** : petit.

<a id="s13"></a>
### S13. Le jeton d'une imprimante peut être lié par le premier qui le présente

- **Gravité** : confort.
- **Où** : `supabase/migrations/20261111090000_impression.sql:75` (la MAC est liée au premier passage, et l'en-tête `X-Star-Mac` est fourni par le client).
- **Observé** (lu dans le code) : entre la création de l'imprimante dans le back-office et son premier passage, quiconque a l'adresse peut se lier à sa place avec une MAC inventée. La vraie imprimante est alors refusée.
- **Correction** : créer l'imprimante, la brancher dans la minute, vérifier sur la tablette qu'elle est « liée ». Dans le back-office, afficher la MAC liée pour la comparer à l'étiquette de l'imprimante.
- **Effort** : petit.

## Non retenu après vérification

- **XSS dans les notes, noms et adresses** : saisies piégées acceptées puis échappées partout (React, courriels, SVG des tickets). Pas de faille.
- **Injection de formules dans l'export CSV** : l'export des ventes ne contient que des nombres et des valeurs fixes. L'export du compte est en JSON.
- **SSRF vers geo.admin.ch** : hôte fixe, identifiant filtré par regex.
- **Redirection ouverte, en-tête d'hôte** : `X-Forwarded-Host` forgé ignoré par Netlify sur la préversion. En production, `URL_SITE` seule. Les URL de retour Stripe sont construites par le serveur.
- **Canal Realtime `tablette`** : le message envoyé ne contient rien (`payload: {}`). Un tiers peut au pire relancer la relecture de la tablette.
- **Clé publiable Supabase** : elle n'est envoyée au navigateur qu'après connexion du personnel. Avec elle, on ne lit que la carte, les zones, les horaires, les fermetures et les réglages, rien de personnel (vérifié sur la vraie base).

## Ce que je n'ai pas pu vérifier

- Les essais d'écriture sans effet et les appels de fonctions sur la vraie base avec la clé publiable : refusés par le garde-fou de la session. Les droits ont été vérifiés sur la base locale, qui rejoue les mêmes migrations, et en lecture sur la vraie base.
- Le parcours S1 sur la préversion elle-même (il écrit un code dans la vraie base). Reproduit en local seulement.
- Le cookie `__Host-` avec `Secure` en conditions réelles : il faut une connexion sur la préversion, donc une écriture. Lu dans le code.
- Que Netlify écrase un `x-nf-client-connection-ip` envoyé par le client. Supposé, comme le dit la documentation de Netlify. Non testé pour ne pas toucher aux compteurs de la vraie base.
- Le webhook Stripe réel, le mode TWINT et les remboursements : pas de compte Stripe encore. Logique relue, tests unitaires présents (`tests/unit/paiement.test.ts`).
- Le contenu actuel de la vraie base (membres du personnel, imprimantes, sessions ouvertes, journal de gestion) : ces tables sont fermées à la clé publiable, comme il se doit.
- Le temps de réponse de S11 : il faut Resend.

## Points à contrôler le jour de la bascule

À ajouter à la phase 4 de `docs/mise-en-ligne.md`. Les trois premiers sont à faire **avant la recette** (phase 3), pas le jour même.

1. `SUPABASE_SECRET_KEY` retirée des contextes Deploy Previews et Branch deploys, ou remplacée par la clé d'un projet de test (S1, S2, S10).
2. `equipe@laferme.test` supprimé de la vraie base, et l'`insert` sorti de la migration (S1).
3. `SECRET_COMPTES` posée en production, différente de tout ce qu'ont les préversions (S6).
4. `journal_gestion` relu : aucune modification de prix, d'allergène ou de validation faite par « Équipe test » sans explication (S1).
5. Imprimantes de test supprimées. Les vraies imprimantes « liées » avec leur MAC vérifiée sur l'étiquette (S3, S13).
6. Commandes, courriels, événements de paiement et compteurs de test vidés (déjà prévu).
7. `STRIPE_SECRET_KEY` live et `STRIPE_WEBHOOK_SECRET` du webhook live dans le seul contexte Production. Webhook live vers `https://<domaine>/api/stripe/webhook` avec les quatre événements. La clé `sk_test_` reste dans les préversions.
8. Déploiement par le build Netlify uniquement, jamais par un build du poste (S7). Après le déploiement : `/api/diagnostic/latence`, `/dev/courriels?jeton=…` et `/paiement-test/<id>` répondent 404.
9. Sur le domaine : le cookie de session commence par `__Host-` et porte `Secure`. Le code de connexion n'apparaît jamais à l'écran.
10. Premier vrai paiement TWINT, refus sur la tablette, remboursement reçu (déjà prévu). Vérifier dans Stripe que l'événement est en mode live.
