# bo-socle : coque, kit, accueil, droits et connexion de l'équipe (vague 3)

Ce que `bo-socle` a construit, pour l'équipe et pour les autres sessions. Le kit a son propre mode d'emploi : `docs/vague-3/kit-back-office.md`.

## Codes de connexion de l'équipe

- **Plafond global sur 24 heures** (migration `20261210160000_plafond_codes_equipe.sql`). Il est **désactivé** tant que Jérémy n'a pas donné la valeur : le réglage `plafond_codes_personnel_jour` est absent. Une fois activé, au plafond, le site ne crée plus de code pour l'équipe. Il répond comme pour une adresse inconnue et prévient le restaurant une fois par 24 heures. Ce compteur est séparé de celui des clients (150 par jour) : un client ne peut jamais bloquer la connexion de l'équipe. Une fois activé, une adresse ne peut prendre qu'un quart du plafond sur 24 heures et une IP la moitié. Pour couper toute l'équipe, il faut donc au moins quatre adresses connues. Les appareils déjà connectés restent connectés. Pour l'activer :
  `insert into reglages (cle, valeur, proposition) values ('plafond_codes_personnel_jour', '<nombre>', false) on conflict (cle) do update set valeur = excluded.valeur, proposition = false;`
- **Adresse bloquée après 15 codes faux** : si la limite d'envoi du jour refuse le courriel au membre, l'alerte au restaurant part quand même. Elle précise que le membre n'a rien reçu.
- Tests : `tests/unit/codes-equipe.test.ts`.

## Recherche globale (⌘K)

Le bouton « Recherche » de l'en-tête, ou ⌘K sur Mac et Ctrl+K sur PC. Il trouve :
- une commande par son numéro, le nom ou le téléphone du client ;
- un client par son nom ou son téléphone ;
- le nom avant le prénom (« bonardi yanis » : chaque mot doit figurer, dans n'importe quel ordre) et le début d'un e-mail tapé sans @ (« yanis.bon », trois caractères au moins avec une lettre). La liste de Commandes et la rubrique Clients en profitent aussi ;
- un plat ;
- une rubrique par son nom ou ce qu'on y fait.

Les flèches choisissent, Entrée ouvre, Échap ferme. Le texte cherché part en POST (`/api/gestion/recherche`, gérant seulement) et n'apparaît jamais dans l'adresse. La recherche ne refait aucune requête : elle demande cinq résultats aux listes de `bo-commandes` (`liste_commandes_gestion`, `clients_gestion`) et au catalogue. La fiche visée s'ouvre en arrivant sur la rubrique par `useOuverture` (kit) : Commandes, Clients et Carte doivent l'appeler pour leurs fiches.

## Droits fins : responsable de service (D1)

Jérémy a dit oui le 13.11.2026. Le rôle agit dès que le réglage `role_responsable_actif` vaut `true` en base (posé par le chef sur la vraie base une fois toutes les PR de l'activation dans `main`) :
`insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false) on conflict (cle) do update set valeur = excluded.valeur, proposition = false;`
Le remettre à `false` coupe tout de suite les droits des responsables déjà nommés. La base embarquée (`supabase/local/donnees-test.sql`) a le rôle activé, avec un compte responsable par fichier de test : `responsable-{socle,commandes,tablette,operations}-{bureau,mobile}@laferme.test`.

- **Base.** Migration `20261210230000_droits_responsable.sql`. `droit_personnel(personnel, action)` porte le tableau D1, action par action : le gérant peut tout, le responsable seulement ses sept actions, l'équipe de service aucune. `auteur_droit(personnel, action)` fait comme `gerant_nom` pour une action précise et refuse avec `droit_refuse`.
- **Serveur.** `exigerDroit(requete, action)` (`src/lib/personnel/session.ts`) laisse passer le gérant et, quand le rôle est activé, le responsable pour ses actions. Les actions sont dans `src/lib/personnel/droits.ts`.
- **Écran.** `useDroit(action)` et `useRoleGestion()` (`src/components/gestion/droits.tsx`, fournis par la coque) cachent les gestes qu'il n'a pas ; le serveur revérifie toujours. Le responsable arrive sur Commandes (l'accueil montre les ventes, réservées au gérant). Son menu : Commandes, Clients et Équipe. Une rubrique fermée tapée à la main affiche « Réservé ».
- **bo-socle (fait).**
  - Équipe réduite à « déconnecter un appareil perdu » : pas d'accès, d'ajout, de retrait ni de « Déconnecter partout ». Jamais les appareils d'un gérant (refus en base dans `appareils_personnel` et `couper_appareil_personnel`).
  - Recherche ⌘K : commandes, clients et rubriques ouvertes, sans les plats.
  - Routes `/api/gestion/personnel` et `/api/gestion/recherche` en `exigerDroit`.
- **Chez les propriétaires (liste envoyée le 13.11).**
  - bo-commandes : routes Commandes, Clients, Réclamations action par action (`voir_commandes`, `rembourser`, `modifier_commande`, `annuler_apres_prete`), `demander_remboursement` et `modifier_commande` en base.
  - tablette : annulation d'une livraison partie, modification depuis la tablette, coup de feu.
  - bo-operations : fermer le service du jour (`fermer_service`), avec le bouton sur la tablette.
- Tests : `tests/unit/droits-responsable.test.ts`, `tests/unit/responsable-appareils-sql.test.ts`, `tests/e2e/gestion-responsable.spec.ts`.

## Appareils connectés de l'équipe

Dans Équipe, chaque membre connecté a un bouton « Appareils (n) ». Il ouvre la liste de ses appareils : le navigateur et l'appareil (« Safari sur iPad », « Chrome sur Android »), la date de connexion et la dernière activité. « Déconnecter » coupe un seul appareil, après confirmation : une tablette volée ou le téléphone perdu d'un livreur, sans déconnecter les autres. « Déconnecter partout » reste à côté.

- Rien de personnel n'est gardé : ni adresse IP, ni empreinte du navigateur. Seulement un libellé court, calculé à la connexion, le même que pour les appareils du compte client (`src/lib/comptes/appareil.ts`).
- La dernière activité est notée au plus une fois toutes les cinq minutes par appareil.
- Migration `20261210250000_appareils_equipe.sql` : colonnes `appareil` et `vue_le` de `sessions_personnel`, fonctions `noter_appareil_personnel`, `voir_session_personnel`, `appareils_personnel` et `couper_appareil_personnel`. Ces deux dernières sont réservées au gérant et la coupure va au journal. Le code marche avant la migration : la connexion ignore l'échec de `noter_appareil_personnel`.
- Le responsable de service coupe aussi un appareil (droit `deconnecter_appareil`), jamais celui d'un gérant.
- Tests : `tests/unit/appareils-equipe.test.ts`, `tests/e2e/gestion-appareils.spec.ts`.

## Alertes (relance du chef de produit, 13.11)

L'accueil ne suffisait pas : Giuseppe en salle ne regarde pas l'accueil. Le centre d'alertes (`src/components/gestion/alertes.tsx`) lit `/api/gestion/accueil` une seule fois pour toute la coque, toutes les 20 secondes, même onglet caché (le navigateur espace alors à une lecture par minute environ). Gérant seulement : l'accueil est réservé au gérant.

- **Sur toutes les pages** : le nombre d'alertes devant le titre de l'onglet (« (3) Commandes »), un badge sur « Accueil » dans le menu et sur le bouton « Menu » au téléphone. Badge foncé quand une alerte bloque le service.
- **Notifications du navigateur**, à demander sur chaque appareil (« Régler les alertes » sur l'accueil). Seulement une alerte apparue après l'ouverture de la page, d'un type coché, et pas quand l'accueil est sous les yeux. Une alerte réglée puis revenue prévient de nouveau. Le back-office doit rester ouvert dans un onglet.
- **Catégories réglables** (`src/lib/alertes-accueil.ts`, clés stables) : `acceptation`, `tablette`, `pause`, `impression`, `retard`, `livreurs`, `remboursements`, `courriels`, `comptoir`. Par défaut tout est coché sauf remboursements et comptoir, qui peuvent attendre la fin du service. Les préférences restent dans le navigateur (`laferme.gestion.alertes`). À ne pas confondre avec les types des alertes **par e-mail** de `bo-operations` (`src/lib/alertes-types.ts`, réglés pour tout le restaurant dans Réglages).
- **Alertes avec une issue** : remboursements (en échec, pas confirmés) et commandes au comptoir pas encaissées citent chaque commande avec son jour (« N° 39, jeudi 12 novembre », les numéros repartent chaque jour). Un clic ouvre sa fiche dans Commandes, sans rien mettre dans l'adresse. « Voir la liste » ouvre Commandes filtrée par l'adresse : `?remboursement=echec|en_cours&du=&au=` et `?paiement=a_encaisser_retrait&du=&au=`. Les filtres de l'adresse sont lus par Commandes (`bo-commandes`, liste des paramètres dans `docs/back-office/commandes-clients.md`).
- **Aucun livreur prévu** : l'alerte de `bo-operations` (`src/lib/sans-livreur.ts`, #189), rangée dans la catégorie `livreurs`. Elle dit si le réglage « Fermer la livraison d'un service sans livreur prévu » a fermé la livraison.
- **E-mails** : « E-mails : n sur 500 aujourd'hui » dans le bloc Restaurant, en plus de l'alerte à 80 %.
- Tests : `tests/unit/accueil-gestion.test.ts`, `tests/e2e/gestion-accueil.spec.ts`.

## Équipe

- La liste d'accès de chaque membre a des libellés courts (« Livreur » au lieu de « Livreur (ses livraisons sur son téléphone) »), le détail est écrit sous le titre et sous le champ d'ajout. Elle ne déborde plus à 1280 px.
- Chaque membre montre sa dernière activité (connexion ou passage sur un appareil), ou « Jamais connecté ». `liste_personnel` donne `derniere_activite` (migration `20261212140000_recherche_equipe.sql`).

