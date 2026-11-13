# Imprimantes au back-office (vague 3, bo-operations)

En plus de l'état en direct (en ligne, papier, capot), le back-office donne pour chaque imprimante ce qu'elle a vraiment fait. Migration `supabase/migrations/20261130150000_imprimantes_resume.sql`, fonction `resume_imprimantes()`, route `GET /api/gestion/imprimantes` (champ `resume` de chaque imprimante).

| Champ | Ce que c'est |
|---|---|
| `dernier_ticket_le` | Heure du dernier ticket confirmé par l'imprimante. « En ligne » sans ticket depuis le début du service : à vérifier |
| `en_attente`, `plus_ancien_en_attente_le` | Tickets envoyés ou à envoyer, pas encore confirmés, et depuis quand. Un ticket qui attend plus de deux minutes est renvoyé avec la mention « RENVOI » (`docs/impression.md`) |
| `imprimes_aujourdhui`, `echecs_aujourdhui` | Depuis minuit, heure de Genève |

- Aucune donnée de client : ni nom ni numéro de commande.
- Les tickets de test, sans commande, comptent aussi : un test sorti prouve le branchement. Le bouton « Imprimer un ticket de test » arrive avec la PR de la session `tablette` (`ticket_de_test`, `src/lib/impression/test.ts`).
- Que faire en panne : `docs/pannes.md`, « L'imprimante ne sort rien ». L'écran y renverra.

Avant la migration, `resume` vaut null et l'écran garde l'état en direct seul.
