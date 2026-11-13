# Messages d'information aux clients (vague 3, bo-operations)

Une bannière sur le site, par exemple pour une fermeture, un retard général ou une nouveauté. Le gérant la programme et elle disparaît seule à sa fin. Migration `supabase/migrations/20261130160000_messages_clients.sql`, logique `src/lib/messages-clients.ts`, route `/api/gestion/messages` (gérant), écran `/gestion/messages` (`src/components/gestion/GestionMessages.tsx`). L'affichage sur le site est fait par la session `client-commande`.

## Règles

- **Texte** : de 5 à 200 caractères, écrit par le gérant. Le site n'en propose aucun. Un texte lu par les clients passe par Jérémy (règle des textes, `redaction-fr`).
- **Quand** : le début va de maintenant à 60 jours, la durée est de 60 jours au plus, et 5 messages au plus restent en cours ou à venir. Un client ne lit jamais une pile de bandeaux.
- **Où** :
  - `accueil` : la page d'accueil seulement ;
  - `partout` : l'accueil, la carte, le panier et le paiement.
- **Retirer** : retiré avant sa fin, le message quitte le site en moins d'une minute (cache de la config vidé).
- **Journal** : objet `message_client`, avec le texte, les dates et l'emplacement. `apres` est vide quand le message est retiré.
- Le nom de qui l'a écrit reste au back-office : il n'est jamais envoyé au site.

## L'écran (rubrique « Messages aux clients »)

- **Sur le site** : les messages en ligne et à venir, avec où, quand et qui les a programmés. « Retirer » demande confirmation, puis le message quitte le site en moins d'une minute.
- **Programmer un message** : le texte (compteur sur 200), l'emplacement (accueil seulement ou tout le site), le début (tout de suite ou une date et une heure) et la fin. Un résumé dit ce que verront les clients (« Visible sur l'accueil. Dès maintenant, jusqu'à aujourd'hui à 23h00. »). Avec cinq messages prévus, le formulaire laisse la place à une consigne : en retirer un d'abord.
- **Les 30 derniers jours** : les messages finis ou retirés.
- L'aide du champ rappelle la règle des textes : faire valider par Jérémy, jamais un nom ni un numéro de commande.
- Test : `tests/e2e/gestion-messages.spec.ts` (compte `ecran-messages@laferme.test`), captures `docs/rendus/vague-3/bo-operations/messages-*.png`.

## Pour l'affichage (`client-commande`)

- `config.messages` contient les messages pas finis qui commencent dans les 24 heures.
- `messagesVisibles(config.messages, page, Date.now())` rend ceux à montrer maintenant sur cette page, à la minute près malgré le cache. L'heure réelle compte, comme pour la pause : l'heure simulée des préversions ne les change pas.
- Le texte est du texte brut : à afficher comme texte, jamais en HTML.

## Route

- `GET /api/gestion/messages` : les messages pas finis et ceux des 30 derniers jours, avec `cree_par` et `retire_le`.
- `POST { type: "ajouter", texte, debut?, fin, emplacement? }` : `debut` absent veut dire maintenant, et l'emplacement par défaut est `accueil`.
- `POST { type: "retirer", id }`.

## Avant et après la migration

Avant la migration, `config.messages` vaut `[]` et la route répond une erreur (aucun écran ne l'appelle). Après la migration, rien n'apparaît tant que le gérant ne programme pas de message.
