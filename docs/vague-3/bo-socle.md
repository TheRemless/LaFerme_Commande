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
- un plat ;
- une rubrique par son nom ou ce qu'on y fait.

Les flèches choisissent, Entrée ouvre, Échap ferme. Le texte cherché part en POST (`/api/gestion/recherche`, gérant seulement) et n'apparaît jamais dans l'adresse. La recherche ne refait aucune requête : elle demande cinq résultats aux listes de `bo-commandes` (`liste_commandes_gestion`, `clients_gestion`) et au catalogue. La fiche visée s'ouvre en arrivant sur la rubrique par `useOuverture` (kit) : Commandes, Clients et Carte doivent l'appeler pour leurs fiches.

## Droits fins : responsable de service (D1, désactivé)

Le rôle « Responsable de service » de la décision D1 est construit, mais **désactivé** tant que Jérémy n'a pas tranché : le réglage `role_responsable_actif` est absent et personne ne peut recevoir ce rôle. Pour l'activer :
`insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false) on conflict (cle) do update set valeur = excluded.valeur, proposition = false;`
Le remettre à `false` coupe tout de suite les droits des responsables déjà nommés.

- **Base.** Migration `…_droits_responsable.sql`. `droit_personnel(personnel, action)` porte le tableau D1, action par action : le gérant peut tout, le responsable seulement ses actions, l'équipe de service aucune. `auteur_droit(personnel, action)` fait comme `gerant_nom` pour une action précise et refuse avec `droit_refuse`. `ajouter_personnel` et `modifier_personnel` n'acceptent « responsable » que si le rôle est activé.
- **Serveur.** `exigerDroit(requete, action)` (`src/lib/personnel/session.ts`) laisse passer le gérant et, quand le rôle est activé, le responsable pour ses actions. Les noms des actions sont dans `src/lib/personnel/droits.ts`.
- **Écran.** Le back-office s'ouvre au responsable seulement quand le rôle est activé. Il ne voit que les rubriques qui portent un `droit` dans `navigation.ts` (Commandes, et Clients à venir). Il arrive sur Commandes : l'accueil montre les ventes, réservées au gérant. Une rubrique fermée tapée à la main affiche « Réservé ». Sur la tablette, il a les gestes de l'équipe. Il les garde même si le rôle est désactivé ensuite : le gérant lui rend alors un autre accès dans Équipe. L'écran Équipe ne propose ce rôle qu'une fois activé.
- **À brancher par les propriétaires le jour de l'activation.** Il faut remplacer `exigerGerant` par `exigerDroit(…, action)` et `gerant_nom` par `auteur_droit(…, action)` dans :
  - les routes et fonctions de remboursement, d'annulation, de client absent, de modification de commande et de liste des commandes (bo-commandes) ;
  - l'annulation d'une livraison partie (`src/lib/tablette.ts`, tablette) ;
  - la déconnexion d'un appareil (bo-socle) ;
  - la fermeture du service (bo-operations).
  Les fonctions `modifier_commande` et `coup_de_feu`, qui acceptent `role in ('service', 'gerant')`, doivent aussi accepter `responsable`.
