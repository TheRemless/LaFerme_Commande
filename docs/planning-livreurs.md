# Planning et suivi des livreurs (vague 3, bo-operations)

Migration `supabase/migrations/20261130120000_planning_livreurs.sql`, serveur `src/lib/planning-livreurs.ts`, route du back-office `/api/gestion/livreurs` (gérant). L'écran du back-office (rubrique « Livreurs ») attend la coque de `bo-socle`.

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

## Route

- `GET /api/gestion/livreurs?debut=&fin=&stats_debut=&stats_fin=` renvoie `{ periode, periode_stats, semaines, planning, stats }`.
- `POST { type: "semaine", livreur, creneaux: [{ jour: 1 à 7, service }] }` : la liste remplace l'ancienne. Une liste vide veut dire aucun service habituel.
- `POST { type: "jour", livreur, jour: "AAAA-MM-JJ", service, present: true | false | null, motif? }`.

## Avant et après la migration

Avant la migration, la route répond une erreur (fonctions absentes). Aucun écran ne l'appelle encore. Après la migration, le planning est vide jusqu'à ce que le gérant règle une semaine type.
