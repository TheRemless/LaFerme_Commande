# Calendrier du back-office (vague 3, bo-operations)

Voir d'un coup d'œil ce que le client verra chaque jour, pourquoi, et ce qu'une fermeture toucherait. Logique `src/lib/calendrier.ts` (fonctions pures), commandes prises `reservations_par_jour` (migration `supabase/migrations/20261130140000_calendrier.sql`), route `/api/gestion/calendrier` (gérant). Écran : back-office, rubrique « Calendrier » (`/gestion/calendrier`, `src/components/gestion/GestionCalendrier.tsx`).

## Ce que donne chaque jour

Pour midi et pour le soir :
- `ouvert` : le client peut commander pour ce service, avec ses heures ;
- `source`, ce qui décide :
  - `habituel` : les horaires de la semaine ;
  - `ouverture` : une ouverture exceptionnelle ;
  - `fermeture` : une fermeture, avec son motif (journée, ou un seul service) ;
  - `pas-de-service` : rien ce jour-là, comme le dimanche ou le lundi ;
- `commandes` : livraisons et retraits déjà pris, sans aucune donnée de client. On les voit avant de poser une fermeture. Le détail par numéro reste donné après coup (vague 2, G15).

Le jour porte aussi son férié éventuel.

La règle est la même que celle du site : `servicesDu` dans `src/lib/service.ts`, désormais exportée.

## Jours fériés genevois

Source : loi sur les jours fériés du canton de Genève (rsGE J 1 45), art. 1 al. 1, lue le 13.11.2026 sur `silgeneve.ch/legis/data/rsg_j1_45.htm`. Neuf jours :
- Nouvel An (1er janvier) ;
- Vendredi saint, lundi de Pâques, Ascension, lundi de Pentecôte, qui suivent Pâques (calcul grégorien) ;
- Fête nationale (1er août) ;
- Jeûne genevois, le jeudi qui suit le premier dimanche de septembre ;
- Noël (25 décembre) ;
- Restauration de la République (31 décembre).

Le report d'un férié tombé un dimanche (art. 1 al. 2) ne vise que les entreprises hors de la loi fédérale sur le travail : il n'est pas compté.

**Ce ne sont que des propositions.** `feries_a_confirmer` liste les fériés de l'année à venir où le restaurant serait ouvert d'après ses horaires. Le gérant décide un par un : fermer (fermeture ordinaire, `/api/gestion/service`) ou laisser ouvert. Rien ne ferme sans lui. Jérémy dira quels fériés le restaurant travaille (question D10 du chef).

## Mode d'emploi (gérant)

Back-office, rubrique « Calendrier ».
- **Le mois.** Une case par jour, avec pour midi et soir les heures, « fermé : motif » ou « — » (pas de service). La case d'aujourd'hui a un cadre épais, les jours passés sont grisés. Les commandes déjà prises s'affichent en gras (« 3 liv., 2 à emp. »). « Mois précédent » et « Mois suivant » pour naviguer. Au téléphone, les jours sont en liste.
- **Jours fériés où vous seriez ouvert.** En tête, les fériés de l'année à venir où vos horaires disent « ouvert ». Toucher un férié ouvre sa fiche. Rien ne ferme tout seul.
- **Fermer un jour ou un service.** Toucher la case du jour, puis choisir « Toute la journée » ou « Le midi seulement » (ou le soir), écrire le motif (les clients le lisent) et toucher « Fermer ». La confirmation dit combien de commandes sont déjà prises. Après, les numéros à annuler sur la tablette s'affichent.
- Pour ouvrir exceptionnellement un jour fermé ou retirer une fermeture : rubrique « Livraison et horaires ».

Captures : `docs/rendus/vague-3/bo-operations/calendrier-1024.png` et `calendrier-375.png`.

## Route

`GET /api/gestion/calendrier?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` : 62 jours au plus. Sans date, c'est aujourd'hui et les 41 jours suivants. Réponse : `{ debut, fin, jours, commandes_disponibles, feries_a_confirmer }`.

## Avant et après la migration

Avant la migration, `reservations_par_jour` n'existe pas. Le calendrier s'affiche quand même, avec `commandes_disponibles: false` et des nombres à zéro.

## Ce que le gérant règle lui-même (audit du 13.11.2026)

Demande de Jérémy : « Faudrait qu'on puisse ajuster nous-mêmes les jours de vacances ou fermetures depuis le back-office. Même s'il y a des jours fixes fermés chaque semaine, faut qu'on puisse avoir pas mal de choix ». Rien n'est figé dans le code : tout se règle au back-office.

| Besoin | Où | Depuis |
|---|---|---|
| Jour fermé chaque semaine (midi, soir ou journée), ou service ouvert chaque semaine | Livraison et horaires, onglet Horaires, « Semaine type » | Ce PR (`20261213120000_semaine_type.sql`) |
| Heures de chaque service ouvert | Livraison et horaires, onglet Horaires | Lot 7 |
| Vacances sur une plage de dates | Livraison et horaires, onglet Fermetures, « Des journées entières », du … au … | Lot 7 |
| Fermeture exceptionnelle d'un service (un midi, un soir) | Calendrier, fiche du jour, ou onglet Fermetures | Vague 2 et 3 |
| Ouverture exceptionnelle (jour fermé d'habitude, autres heures) | Livraison et horaires, onglet Fermetures, « Ouvertures exceptionnelles » | Vague 2 |
| Jours fériés de Genève | Calendrier : marqués « à confirmer », « Fermer » en un geste | Vague 3 |
| Aperçu de ce que voit le client | Calendrier : le mois, jour par jour et service par service | Vague 3 |
| Commandes déjà prises | Calendrier (par jour), message après une fermeture, et confirmation avant « Fermer chaque semaine » (commandes à venir ce jour de la semaine) | Vague 2 et 3 |

Fériés : la liste suit la loi genevoise (rsGE J 1 45, calculée dans `src/lib/calendrier.ts`) et ne fait que proposer. Le restaurant ferme ou reste ouvert d'un geste.

### Semaine type

- Une case par jour et par service : ses heures et « Fermer », ou « Fermé » et « Ouvrir ». « Fermer la journée » ferme midi et soir d'un geste.
- Fermer chaque semaine retire le service de la semaine (le journal garde ses heures, objet `horaire_semaine`). Avant, la confirmation dit combien de commandes déjà prises pour ce jour de la semaine restent valables (`commandes_jour_semaine`) : elles ne sont jamais annulées seules.
- Ouvrir propose les heures du même service un autre jour, à vérifier, puis l'enregistre.
- Gérant seulement, revérifié en base. Route `/api/gestion/service` (`semaine-fermer`, `semaine-ouvrir`, `semaine-commandes`).
- Tests : `tests/unit/semaine-type-sql.test.ts`, `tests/e2e/gestion-service-v3.spec.ts` (ouvrir puis refermer le dimanche midi). Capture : `docs/rendus/vague-3/bo-operations/horaires-semaine-type-1024.png`.

## Fermer le service du jour (rôle responsable de service)

Une panne, un coup dur pendant le service : le gérant ou le responsable de service (droit `fermer_service` du tableau D1, quand `role_responsable_actif` est à true) ferme ce midi, ce soir ou toute la journée d'aujourd'hui, avec un motif lu par les clients. Migration `20261213130000_fermer_service_du_jour.sql`, serveur `src/lib/fermer-service.ts`.

- **Aujourd'hui seulement** : la date vient de la base (heure de Genève), jamais de l'appelant. Les autres fermetures, les horaires et les zones restent au gérant.
- **Déjà fermé** (toute la journée, ou ce service) : refusé, rien n'est ajouté.
- **Après la fermeture**, la réponse donne les numéros des commandes déjà prises pour ce moment, à traiter sur la tablette, comme pour les autres fermetures. Les pages publiques se mettent à jour (cache de la config vidé), la tablette est prévenue.
- **Contrôle** : `auteur_droit(p_personnel, 'fermer_service')` en base, journalisé (objet `fermeture`, au nom de l'auteur).
- **Route du back-office** : `POST /api/gestion/fermer-jour { quoi: "midi" | "soir" | "journee", motif }`, derrière `exigerDroit(requete, "fermer_service")`. La tablette a son bouton, sur la même fonction `fermerServiceDuJour(personnel, quoi, motif)`.
- Tests : `tests/unit/fermer-service-sql.test.ts` (responsable, gérant, refus de l'équipe, du livreur et du rôle éteint, déjà fermé, autres dates, horaires et zones refusés au responsable), `fermer-service.test.ts`.
- E2e : `tests/e2e/fermer-service.spec.ts` (compte `responsable-operations-*` : la route et la base laissent passer le responsable, puis refusent un motif trop court ; une autre date, les horaires et les zones lui sont refusés ; l.équipe de service est refusée). Il ne ferme jamais le service du jour, car la base de test est commune.
