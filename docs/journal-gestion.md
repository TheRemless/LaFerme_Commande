# Journal du back-office (vague 3, bo-pilotage)

Rubrique `/gestion/journal`, écran `src/components/gestion/GestionJournal.tsx`, module `src/lib/journal.ts`, route `POST /api/gestion/journal`, migration `supabase/migrations/20261129130000_journal_recherche.sql`. Tests : `tests/unit/journal-recherche-sql.test.ts`, `tests/unit/journal.test.ts`, `tests/e2e/gestion-journal.spec.ts`. Captures : `docs/rendus/vague-3/bo-pilotage/journal-*.png`.

## Ce que fait l'écran

- Filtres : « Chercher » (dans la clé et les valeurs avant et après, sans tenir compte des majuscules, % et _ cherchés tels quels), « Quoi » (objets présents dans le journal, avec leur nombre de lignes), « Qui », « Du » et « Au » (jours à Genève). « Filtrer » applique, « Tout afficher » enlève les filtres.
- Cent lignes à la fois, de la plus récente à la plus ancienne, puis « Afficher les suivantes » (curseur sur l'identifiant : une ligne ajoutée entre-temps ne décale rien).
- États : chargement, aucun résultat (avec ou sans filtres), réseau coupé avec « Réessayer ». Une réponse lente d'une recherche précédente n'écrase pas la nouvelle.
- « Annuler » inchangé (audit du gérant, G11).
- Sur téléphone, les filtres passent sur deux colonnes.

## Route

`POST /api/gestion/journal` (gérant), en POST pour qu'un nom cherché n'apparaisse jamais dans une adresse :

- `{ action: "chercher", auteur?, objet?, debut?, fin?, recherche?, avant_id?, limite? }` rend `{ entrees, suivant }`. `limite` : 100 par défaut, 200 au plus.
- `{ action: "filtres" }` rend `{ auteurs: [{ nom, lignes }], objets: [{ objet, lignes }] }`.
- `{ action: "annuler", id }` : inchangé.

`GET` (les 200 dernières lignes) reste en place pour les écrans qui l'appellent encore.

## Libellés des objets

Les noms des objets pour l'équipe sont dans `NOMS_OBJETS` (`src/lib/journal.ts`). Les titres et les résumés de chaque ligne sont dans `src/components/gestion/journal-lignes.ts` (testés dans `tests/unit/journal-lignes.test.ts`). Chaque titre nomme ce qui a changé : « Supplément Lardons », « Réglage, retard ajouté aux heures » (nom du réglage dans `NOMS_REGLAGES`, sinon sa clé). Une ligne sans changement visible (même valeur avant et après, ou seule « Proposition » change) ne s'affiche pas. Ceux ajoutés par d'autres rubriques suivent leur contrat :

| Objet | Rubrique | Résumé | Contrat |
|---|---|---|---|
| `coup_de_feu` | bo-operations | « Lancé : +20 min, 2 livraisons par créneau, jusqu'à 21h00 », « Fini », « Fini à l'heure prévue » | `docs/coup-de-feu.md` |
| `zone_services` | bo-operations | « Zone 3 : le soir seulement » | `docs/zones-services.md` |
| `zone_fermeture` | bo-operations | « Zone 2 fermée jusqu'à 21h00 : Neige », « Zone 2 rouverte » | `docs/zones-services.md` |
| `livreur_semaine`, `livreur_jour` | bo-operations | « Marco : mardi soir, mercredi soir », « Marco absent vendredi 20 novembre soir : Malade » | `docs/livreurs.md` |
| `cloture` | bo-pilotage | « Jour du … : attendu au comptoir CHF …, compté CHF …, écart CHF … » | `docs/pilotage.md` |
| `commande`, `note_commande`, autres | bo-commandes, bo-carte | Résumé général : champ par champ, avant → après | |

Un objet inconnu de l'écran s'affiche avec son nom technique et le résumé général : rien ne disparaît.
