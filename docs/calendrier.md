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

## Fermer le service du jour (rôle responsable de service)

Une panne, un coup dur pendant le service : le gérant ou le responsable de service (droit `fermer_service` du tableau D1, quand `role_responsable_actif` est à true) ferme ce midi, ce soir ou toute la journée d'aujourd'hui, avec un motif lu par les clients. Migration `20261213130000_fermer_service_du_jour.sql`, serveur `src/lib/fermer-service.ts`.

- **Aujourd'hui seulement** : la date vient de la base (heure de Genève), jamais de l'appelant. Les autres fermetures, les horaires et les zones restent au gérant.
- **Déjà fermé** (toute la journée, ou ce service) : refusé, rien n'est ajouté.
- **Après la fermeture**, la réponse donne les numéros des commandes déjà prises pour ce moment, à traiter sur la tablette, comme pour les autres fermetures. Les pages publiques se mettent à jour (cache de la config vidé), la tablette est prévenue.
- **Contrôle** : `auteur_droit(p_personnel, 'fermer_service')` en base, journalisé (objet `fermeture`, au nom de l'auteur).
- **Route du back-office** : `POST /api/gestion/fermer-jour { quoi: "midi" | "soir" | "journee", motif }`, derrière `exigerDroit(requete, "fermer_service")`. La tablette a son bouton, sur la même fonction `fermerServiceDuJour(personnel, quoi, motif)`.
- Tests : `tests/unit/fermer-service-sql.test.ts` (responsable, gérant, refus de l'équipe, du livreur et du rôle éteint, déjà fermé, autres dates, horaires et zones refusés au responsable), `fermer-service.test.ts`.
