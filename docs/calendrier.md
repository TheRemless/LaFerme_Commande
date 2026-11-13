# Calendrier du back-office (vague 3, bo-operations)

Voir d'un coup d'œil ce que le client verra chaque jour, pourquoi, et ce qu'une fermeture toucherait. Logique `src/lib/calendrier.ts` (fonctions pures), commandes prises `reservations_par_jour` (migration `supabase/migrations/20261130140000_calendrier.sql`), route `/api/gestion/calendrier` (gérant). L'écran (vue du mois) attend la coque de `bo-socle`.

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

## Route

`GET /api/gestion/calendrier?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` : 62 jours au plus. Sans date, c'est aujourd'hui et les 41 jours suivants. Réponse : `{ debut, fin, jours, commandes_disponibles, feries_a_confirmer }`.

## Avant et après la migration

Avant la migration, `reservations_par_jour` n'existe pas. Le calendrier s'affiche quand même, avec `commandes_disponibles: false` et des nombres à zéro.
