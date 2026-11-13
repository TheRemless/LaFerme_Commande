# Imprimantes au back-office (vague 3, bo-operations)

En plus de l'état en direct (en ligne, papier, capot), le back-office donne pour chaque imprimante ce qu'elle a vraiment fait. Migration `supabase/migrations/20261130150000_imprimantes_resume.sql`, fonction `resume_imprimantes()`, route `GET /api/gestion/imprimantes` (champ `resume` de chaque imprimante).

| Champ | Ce que c'est |
|---|---|
| `dernier_ticket_le` | Heure du dernier ticket confirmé par l'imprimante. « En ligne » sans ticket depuis le début du service : à vérifier |
| `en_attente`, `plus_ancien_en_attente_le` | Tickets envoyés ou à envoyer, pas encore confirmés, et depuis quand. Un ticket qui attend plus de deux minutes est renvoyé avec la mention « RENVOI » (`docs/impression.md`) |
| `imprimes_aujourdhui`, `echecs_aujourdhui` | Depuis minuit, heure de Genève |

- Aucune donnée de client : ni nom ni numéro de commande.
- Les tickets de test, sans commande, comptent aussi : un test sorti prouve le branchement.
- **Imprimer un ticket de test** (imprimante active seulement) : un ticket « TEST » avec le poste, le nom de l'imprimante, l'heure et qui l'a demandé part dans sa file. Il sort dans quelques secondes si l'imprimante est en ligne, sinon à sa reconnexion (le message le dit). Il apparaît dans le résumé comme un ticket en attente, puis sorti. Route `/api/gestion/imprimantes` `{ type: "test", id }`, serveur `imprimerTicketTest` et base `ticket_de_test` (session `tablette`, gérant revérifié et journalisé). Une imprimante désactivée le refuse.
- **Écran** : rubrique « Imprimantes ». Sous chaque imprimante, en plus de son état en direct :
  - le dernier ticket sorti, avec le jour s'il n'est pas d'aujourd'hui ;
  - les tickets en attente et depuis quand ;
  - les tickets imprimés et en échec du jour.
  Des tickets en attente ou en échec s'écrivent en gras, avec un filet à gauche. L'écran se relit toutes les 30 secondes.
- **En cas de panne** : un bloc de l'écran reprend les cinq gestes de `docs/pannes.md`, « L'imprimante ne sort rien ». Captures : `docs/rendus/vague-3/bo-operations/imprimantes-1024.png`.

Avant la migration, `resume` vaut null et l'écran garde l'état en direct seul.

## Renvoyer ses tickets sur une autre

Une imprimante en panne (plus de papier, ne répond plus) : « Renvoyer ses tickets sur une autre », sur sa ligne, puis le choix de l'imprimante de destination. Ses tickets en attente, envoyés sans confirmation ou en échec partent sur l'autre. P1 de `produit-gestion`. Migration `20261130250000_renvoyer_tickets.sql`, route `/api/gestion/imprimantes` `{ type: "renvoyer", id, vers }` (gérant, journalisé).

- **Ce qui part** : seulement les tickets des commandes encore à préparer (acceptées ou en préparation). Un ticket déjà envoyé, donc peut-être sorti, repart marqué « RENVOI : CE TICKET EST PEUT-ÊTRE DÉJÀ SORTI ». Un ticket garde son poste : un ticket pizza sorti en cuisine dit toujours PIZZA.
- **Ce qui reste** : les tickets sortis ou annulés, ceux des commandes prêtes et les tickets de test (ils ne changent jamais d'imprimante).
- **Les tickets suivants** vont encore à l'imprimante en panne tant qu'elle est active. La désactiver les envoie à l'autre imprimante du même poste, ou sur la tablette. L'écran le rappelle, comme « En cas de panne ».
- Tests : `tests/unit/renvoyer-tickets-sql.test.ts`, `tests/e2e/gestion-imprimantes.spec.ts`. Capture : `docs/rendus/vague-3/bo-operations/imprimantes-renvoyer-1024.png`.

