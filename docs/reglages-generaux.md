# Réglages généraux (vague 3, bo-operations)

Des valeurs que le gérant devait faire changer par un développeur. Migration `supabase/migrations/20261130130000_reglages_generaux.sql`, serveur `src/lib/reglages-generaux.ts`, route `/api/gestion/service` (gérant). L'écran attend la coque de `bo-socle`.

| Réglage | Départ | Bornes | Effet |
|---|---|---|---|
| E-mail des alertes | vide : la variable `ALERTE_EMAIL` de Netlify sert | une adresse e-mail | Commande pas acceptée, tablette muette, client absent, remboursement échoué : l'alerte part à cette adresse |
| Codes de connexion des clients par jour (`plafond_codes_clients_jour`) | 150 (décision de Jérémy du 12.11.2026) | de 20 à 450 | Au-delà, plus de code pour les clients jusqu'au lendemain. La boîte d'envoi est limitée à 500 e-mails par jour, confirmations comprises : d'où 450 au plus |
| Longueur d'un créneau (`creneau_minutes`) | 15 | 10, 15, 20 ou 30 | Heures proposées au client. La capacité par créneau compte par créneau : passer de 15 à 30 minutes double le temps couvert par la même capacité |
| Commande à l'avance (`avance_jours`) | 7 | de 0 à 14 jours | 0 : seulement le jour même |

- **Où vit l'e-mail** : la table `reglages` est lisible par tous (le site en a besoin pour les créneaux). L'adresse va donc dans `reglages_prives`, sans aucun droit pour les visiteurs. Elle n'est jamais recopiée dans le journal, qui note seulement « adresse saisie » ou « variable ALERTE_EMAIL ».
- **Journal** : objet `reglage`, comme les autres réglages. Ces quatre-là n'ont pas d'« Annuler ».
- **Effet** : le créneau et les jours à l'avance s'appliquent en moins d'une minute (cache de la config vidé). Le plafond des codes s'applique tout de suite. L'e-mail sert dès l'alerte suivante.
- **Panne de la base ou base pas encore migrée** : l'alerte part à `ALERTE_EMAIL`, comme avant.

## Route

- `POST /api/gestion/service`, `{ "type": "reglage-general", "cle": "alerte_email" | "plafond_codes_clients_jour" | "creneau_minutes" | "avance_jours", "valeur": … }`. Pour revenir à la variable, `valeur: null` sur l'e-mail.
- `GET /api/gestion/service` renvoie `generaux: { plafond_codes_clients_jour, creneau_minutes, avance_jours, alerte_email }`.

## Avant et après la migration

Avant la migration, `generaux` vaut null, l'enregistrement répond une erreur (aucun écran ne l'appelle) et les alertes partent à `ALERTE_EMAIL`. Après la migration, les valeurs restent celles d'aujourd'hui tant que le gérant n'y touche pas.

## Restent dans le code

Le téléphone (022 792 16 89) et l'adresse du restaurant figurent dans les pages légales, le JSON-LD, les e-mails et les messages du site : ce sont des faits validés par Jérémy (registre de faits). Les rendre réglables touche les textes de plusieurs sessions et le référencement. C'est à décider avec Jérémy, et ce n'est pas fait ici.
