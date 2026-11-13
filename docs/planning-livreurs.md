# Planning et suivi des livreurs (vague 3, bo-operations)

Migration `supabase/migrations/20261130120000_planning_livreurs.sql`, serveur `src/lib/planning-livreurs.ts`, route du back-office `/api/gestion/livreurs` (gérant). Écran : back-office, rubrique « Livreurs » (`/gestion/livreurs`, `src/components/gestion/GestionLivreurs.tsx`).

- **Semaine type** (gérant) : les services où chaque livreur travaille d'habitude. Par exemple, Marco du mardi au samedi soir.
- **Exception d'un jour** (équipe, tablette ou back-office) :
  - absent ce jour-là (malade, congé), avec un motif facultatif ;
  - en plus ce jour-là (renfort) ;
  - ou retour à la semaine type.
  Du jour même à 60 jours. Un livreur malade appelle à 18h : la personne de la tablette le note tout de suite.
- **Qui travaille ce soir** : `planning_livreurs(debut, fin)` donne, pour chaque jour et chaque service où quelqu'un est prévu ou noté, les livreurs avec leur source (`semaine`, `ajout`, `absent`) et le nombre de présents. Elle porte sur 31 jours au plus et ne garde que les livreurs actifs. Un livreur retiré de l'équipe disparaît du planning.
- **Statistiques** : `stats_livreurs(debut, fin)` lit les livraisons de la vague 2, jours de vente à l'heure de Genève, 93 jours au plus. Sans date, ce sont les 30 derniers jours. Une ligne par livreur :
  - livraisons attribuées, sans les réattribuées ni les reprises ;
  - livrées, client absent, problèmes signalés ;
  - temps moyen entre « partie » et « terminée » ;
  - retard moyen sur l'heure promise.
  Aucune donnée de client.
- **Journal** : objets `livreur_semaine` et `livreur_jour` (`cle` = prénom du livreur).
- **Pour les autres sessions** :
  - `livreursDuService(jour, service)` : les livreurs prévus pour un service, pour la tablette et pour l'heure promise réaliste, version 2 ;
  - `reglerJour(personnel, …)` : à appeler depuis une route qui a vérifié la session de l'équipe (absence notée sur la tablette).

## Mode d'emploi (gérant)

Back-office, rubrique « Livreurs ». Trois onglets.

**Les 7 prochains jours.** Pour chaque jour, midi et soir, avec le nombre de livreurs prévus en grand.
- Un service ouvert sans livreur est encadré : « Personne de prévu pour livrer » ou « Plus personne pour livrer ». Il faut ajouter quelqu'un, ou fermer la livraison sur la tablette.
- Un service où le restaurant est fermé affiche « Fermé », avec le motif de la fermeture s'il y en a un.
- Un livreur malade : « Absent » à côté de son nom, un motif si on veut (jamais montré aux clients), puis « Noter l'absence ». Son nom est barré et il ne compte plus pour ce service. Sa semaine type ne change pas.
- Il revient finalement : « Comme d'habitude ».
- Un renfort : choisir le livreur dans « Ajouter un livreur… » sous le service, puis « Ajouter ». « Retirer le renfort » l'enlève.

**Semaine type.** Une ligne par livreur, deux cases par jour (midi, soir). Une case noire veut dire qu'il travaille d'habitude ce service. Toucher les cases, puis « Enregistrer » au bout de la ligne. Si on quitte la page sans enregistrer, le back-office le demande.

**Livraisons par livreur.** Pour la période choisie (30 derniers jours au départ) :
- les livraisons attribuées, livrées, avec un client absent, avec un problème signalé ;
- le temps moyen sur la route (de « Je pars » à « Livrée ») ;
- le retard moyen sur l'heure promise.
Le tableau se trie par colonne et s'exporte en CSV.

Captures : `docs/rendus/vague-3/bo-operations/livreurs-*.png`.

## Route

- `GET /api/gestion/livreurs?debut=&fin=&stats_debut=&stats_fin=` renvoie `{ periode, periode_stats, semaines, planning, stats }`.
- `POST { type: "semaine", livreur, creneaux: [{ jour: 1 à 7, service }] }` : la liste remplace l'ancienne. Une liste vide veut dire aucun service habituel.
- `POST { type: "jour", livreur, jour: "AAAA-MM-JJ", service, present: true | false | null, motif? }`.

## Avant et après la migration

Avant la migration, la route répond une erreur (fonctions absentes). Aucun écran ne l'appelle encore. Après la migration, le planning est vide jusqu'à ce que le gérant règle une semaine type.

## Livreurs homonymes

Deux livreurs au même nom (« Nora » deux fois) se distinguent partout dans la rubrique (liste « Ajouter un livreur… », planning, semaine type, statistiques) par le début de leur e-mail : « Nora (nora.b) » et « Nora (nora.k) ». Un nom unique reste tel quel. La comparaison ignore les majuscules. Base : `noms_livreurs()` (migration `20261130270000_noms_livreurs.sql`). Serveur : `src/lib/livreurs-noms.ts`, appliqué par la route `/api/gestion/livreurs` (gérant). Tests : `tests/unit/livreurs-noms.test.ts`, `noms-livreurs-sql.test.ts`.

## Aucun livreur prévu

Le planning disait « Personne de prévu pour livrer » ce soir, mais l'accueil du back-office ne disait rien et le site prenait des livraisons. Migration `20261130240000_sans_livreur.sql`, serveur `src/lib/sans-livreur.ts`.

- **Alerte sur l'accueil** (affichée par `bo-socle`) : « Aucun livreur prévu ce soir » (ou ce midi), avec le lien « Ouvrir le planning ». Elle s'affiche quand le service du moment prend des livraisons (horaire ouvert ce jour-là, au moins une zone ouverte à ce service), que l'heure de dernière commande n'est pas passée et que le planning ne prévoit personne. Elle passe en « Maintenant » une heure avant le début du service. Le détail dit si la livraison reste proposée aux clients. Fonction : `chargerAlerteSansLivreur(config, maintenant)`, qui renvoie une `Alerte` de l'accueil ou `null`.
- **Règle proposée, décochée au départ (décision de Jérémy)** : « Fermer la livraison d'un service sans livreur prévu », dans Réglages généraux, bloc « Ce que le site propose aux clients ». Cochée, un midi ou un soir où le planning ne prévoit aucun livreur n'est pas proposé en livraison, aujourd'hui comme les jours où l'on peut commander à l'avance. Le retrait reste ouvert. Décochée, rien ne change : un planning pas tenu ne ferme jamais la livraison par erreur.
- **Livreurs prévus** : la semaine type, corrigée par les absences et les renforts du jour (`livreurs_prevus(jour, service)`, le même compte que l'écran « Les 7 prochains jours »).
- Tests : `tests/unit/sans-livreur-sql.test.ts`, `sans-livreur.test.ts` (alerte et créneaux), `sans-livreur-config.test.ts`.
