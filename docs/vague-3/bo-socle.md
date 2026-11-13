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

## Droits fins : responsable de service (D1, désactivé)

Le rôle « Responsable de service » de la décision D1 est construit, mais **désactivé** tant que Jérémy n'a pas tranché : le réglage `role_responsable_actif` est absent et personne ne peut recevoir ce rôle. Pour l'activer :
`insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false) on conflict (cle) do update set valeur = excluded.valeur, proposition = false;`
Le remettre à `false` coupe tout de suite les droits des responsables déjà nommés.

- **Base.** Migration `20261210230000_droits_responsable.sql`. `droit_personnel(personnel, action)` porte le tableau D1, action par action : le gérant peut tout, le responsable seulement ses actions, l'équipe de service aucune. `auteur_droit(personnel, action)` fait comme `gerant_nom` pour une action précise et refuse avec `droit_refuse`. `ajouter_personnel` et `modifier_personnel` n'acceptent « responsable » que si le rôle est activé.
- **Serveur.** `exigerDroit(requete, action)` (`src/lib/personnel/session.ts`) laisse passer le gérant et, quand le rôle est activé, le responsable pour ses actions. Les noms des actions sont dans `src/lib/personnel/droits.ts`.
- **Écran.** Le back-office s'ouvre au responsable seulement quand le rôle est activé. Il ne voit que les rubriques qui portent un `droit` dans `navigation.ts` (Commandes seulement ; Clients reste au gérant, décision prise avec bo-commandes, à ouvrir avec ses routes le jour de l'activation). Il arrive sur Commandes : l'accueil montre les ventes, réservées au gérant. Une rubrique fermée tapée à la main affiche « Réservé ». Sur la tablette, il a les gestes de l'équipe. Il les garde même si le rôle est désactivé ensuite : le gérant lui rend alors un autre accès dans Équipe. L'écran Équipe ne propose ce rôle qu'une fois activé.
- **À brancher par les propriétaires le jour de l'activation.** Il faut remplacer `exigerGerant` par `exigerDroit(…, action)` et `gerant_nom` par `auteur_droit(…, action)` dans :
  - les routes et fonctions de remboursement, d'annulation, de client absent, de modification de commande et de liste des commandes (bo-commandes) ;
  - l'annulation d'une livraison partie (`src/lib/tablette.ts`, tablette) ;
  - la déconnexion d'un appareil (bo-socle) ;
  - la fermeture du service (bo-operations).
  Les fonctions `modifier_commande` et `coup_de_feu`, qui acceptent `role in ('service', 'gerant')`, doivent aussi accepter `responsable`.

## Appareils connectés de l'équipe

Dans Équipe, chaque membre connecté a un bouton « Appareils (n) ». Il ouvre la liste de ses appareils : le navigateur et l'appareil (« Safari sur iPad », « Chrome sur Android »), la date de connexion et la dernière activité. « Déconnecter » coupe un seul appareil, après confirmation : une tablette volée ou le téléphone perdu d'un livreur, sans déconnecter les autres. « Déconnecter partout » reste à côté.

- Rien de personnel n'est gardé : ni adresse IP, ni empreinte du navigateur. Seulement un libellé court, calculé à la connexion, le même que pour les appareils du compte client (`src/lib/comptes/appareil.ts`).
- La dernière activité est notée au plus une fois toutes les cinq minutes par appareil.
- Migration `20261210250000_appareils_equipe.sql` : colonnes `appareil` et `vue_le` de `sessions_personnel`, fonctions `noter_appareil_personnel`, `voir_session_personnel`, `appareils_personnel` et `couper_appareil_personnel`. Ces deux dernières sont réservées au gérant et la coupure va au journal. Le code marche avant la migration : la connexion ignore l'échec de `noter_appareil_personnel`.
- Le jour où D1 est activé, couper un appareil passe au droit `deconnecter_appareil` (responsable de service).
- Tests : `tests/unit/appareils-equipe.test.ts`, `tests/e2e/gestion-appareils.spec.ts`.

## Alertes (relance du chef de produit, 13.11)

L'accueil ne suffisait pas : Giuseppe en salle ne regarde pas l'accueil. Le centre d'alertes (`src/components/gestion/alertes.tsx`) lit `/api/gestion/accueil` une seule fois pour toute la coque, toutes les 20 secondes, même onglet caché (le navigateur espace alors à une lecture par minute environ). Gérant seulement : l'accueil est réservé au gérant.

- **Sur toutes les pages** : le nombre d'alertes devant le titre de l'onglet (« (3) Commandes »), un badge sur « Accueil » dans le menu et sur le bouton « Menu » au téléphone. Badge foncé quand une alerte bloque le service.
- **Notifications du navigateur**, à demander sur chaque appareil (« Régler les alertes » sur l'accueil). Seulement une alerte apparue après l'ouverture de la page, d'un type coché, et pas quand l'accueil est sous les yeux. Une alerte réglée puis revenue prévient de nouveau. Le back-office doit rester ouvert dans un onglet.
- **Types réglables** (`src/lib/alertes-types.ts`, clés stables) : `acceptation`, `tablette`, `pause`, `impression`, `retard`, `livreurs`, `remboursements`, `courriels`, `comptoir`. Par défaut tout est coché sauf remboursements et comptoir, qui peuvent attendre la fin du service. Les préférences restent dans le navigateur (`laferme.gestion.alertes`). Le réglage des alertes **par e-mail** est chez `bo-operations` : reprendre ces clés.
- **Alertes avec une issue** : remboursements (en échec, pas confirmés) et commandes au comptoir pas encaissées citent chaque commande avec son jour (« N° 39, jeudi 12 novembre », les numéros repartent chaque jour). Un clic ouvre sa fiche dans Commandes, sans rien mettre dans l'adresse. « Voir la liste » ouvre Commandes filtrée par l'adresse : `?remboursement=echec|en_cours&du=&au=` et `?paiement=a_encaisser_retrait&du=&au=`. Les filtres de l'adresse sont lus par Commandes (`bo-commandes`, liste des paramètres dans `docs/back-office/commandes-clients.md`).
- **Aucun livreur prévu** : alerte quand la livraison est ouverte au service en cours (au moins une zone livrée, service pas fini) et que le planning (`bo-operations`) n'a personne de présent. Elle dit que la livraison reste ouverte aux clients : que faire dans ce cas reste à trancher avec `bo-operations`.
- **E-mails** : « E-mails : n sur 500 aujourd'hui » dans le bloc Restaurant, en plus de l'alerte à 80 %.
- Tests : `tests/unit/accueil-gestion.test.ts`, `tests/e2e/gestion-accueil.spec.ts`.

## Équipe

- La liste d'accès de chaque membre a des libellés courts (« Livreur » au lieu de « Livreur (ses livraisons sur son téléphone) »), le détail est écrit sous le titre et sous le champ d'ajout. Elle ne déborde plus à 1280 px.
- Chaque membre montre sa dernière activité (connexion ou passage sur un appareil), ou « Jamais connecté ». `liste_personnel` donne `derniere_activite` (migration `20261212140000_recherche_equipe.sql`).

