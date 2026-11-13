# Réglages généraux (vague 3, bo-operations)

Des valeurs que le gérant devait faire changer par un développeur. Migration `supabase/migrations/20261130130000_reglages_generaux.sql`, serveur `src/lib/reglages-generaux.ts`, route `/api/gestion/service` (gérant). Écran : back-office, rubrique « Réglages généraux » (`/gestion/reglages`, `src/components/gestion/GestionReglages.tsx`).

| Réglage | Départ | Bornes | Effet |
|---|---|---|---|
| E-mail des alertes | vide : la variable `ALERTE_EMAIL` de Netlify sert | une adresse e-mail | Commande pas acceptée, tablette muette, client absent, remboursement échoué : l'alerte part à cette adresse |
| Codes de connexion des clients par jour (`plafond_codes_clients_jour`) | 150 (décision de Jérémy du 12.11.2026) | de 20 à 450 | Au-delà, plus de code pour les clients jusqu'au lendemain. La boîte d'envoi est limitée à 500 e-mails par jour, confirmations comprises : d'où 450 au plus |
| Longueur d'un créneau (`creneau_minutes`) | 15 | 10, 15, 20 ou 30 | Heures proposées au client. La capacité par créneau compte par créneau : passer de 15 à 30 minutes double le temps couvert par la même capacité. Les commandes déjà prises hors de la nouvelle grille (19h15 après le passage à 30 minutes) ne comptent plus dans la capacité des créneaux voisins : changer un jour sans réservation, jamais pendant un service |
| Commande à l'avance (`avance_jours`) | 7 | de 0 à 14 jours | 0 : seulement le jour même |
| Rythme de la cuisine : pizzas et plats sortis en 15 minutes, minutes en plus au plus, fourchettes annoncées | 0, 0, 45, 15, 10 | 0 à 100 ; 0 à 90 ; 0 à 60 | Heure promise réaliste (`docs/heure-reelle.md`). Débits à 0 : la file n'est pas comptée, en attente des chiffres de Jérémy (D8). L'écran montre la raison en cours |
| « Les plus commandés » et suggestion au panier | non, non (décision C7 de Jérémy en attente) | oui ou non | Interrupteurs de client-commande : section en tête de la carte, boisson ou dessert proposé au panier |
| Annulation par le client (`annulation_client_active`) | non (décision C1 de Jérémy en attente) | oui ou non | Bouton « Annuler ma commande » du suivi (bo-commandes et client-compte). La règle d'annulation elle-même est dans `20261127110000_annulation_client.sql` |

- **Où vit l'e-mail** : la table `reglages` est lisible par tous (le site en a besoin pour les créneaux). L'adresse va donc dans `reglages_prives`, sans aucun droit pour les visiteurs. Elle n'est jamais recopiée dans le journal, qui note seulement « adresse saisie » ou « variable ALERTE_EMAIL ».
- **Journal** : objet `reglage`, comme les autres réglages. Ces cinq-là n'ont pas d'« Annuler ».
- **Effet** : le créneau et les jours à l'avance s'appliquent en moins d'une minute (cache de la config vidé). Le plafond des codes s'applique tout de suite. L'e-mail sert dès l'alerte suivante.
- **Panne de la base ou base pas encore migrée** : l'alerte part à `ALERTE_EMAIL`, comme avant.

## Mode d'emploi (gérant)

Back-office, rubrique « Réglages généraux ». Un seul formulaire, en trois blocs :
- Alertes ;
- Commandes des clients ;
- Connexion des clients.

Changer ce qu'il faut, puis « Enregistrer ». Seules les valeurs changées partent, et « Annuler les changements » remet l'écran comme avant. Une valeur hors limites est signalée sous son champ et rien n'est enregistré. Si on quitte la page sans enregistrer, le back-office le demande.

- E-mail des alertes laissé vide : l'adresse réglée à l'installation du site sert.
- Longueur d'un créneau : à changer un jour sans réservation, jamais pendant un service.
- Annulation par le client : la case reste décochée tant que Jérémy n'a pas décidé.

Captures : `docs/rendus/vague-3/bo-operations/reglages-1024.png` et `reglages-375.png`.

## Interrupteurs : déclarer le sien (pour les autres sessions)

Un réglage oui ou non d'une autre rubrique (par exemple « Les plus commandés », couverts, prénom par plat) se règle ici sans toucher au code de bo-operations. Dans sa propre migration, après avoir créé la clé dans `reglages` :

```sql
insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('ma_cle', 'Ce que voit le gérant à côté de la case', 'Une phrase : effet, décision attendue.', 'catalogue', 100)
  on conflict (cle) do nothing;
```

- `cache` dit quoi vider après un changement : `catalogue` (`/carte`, `/panier`), `config-service` (la config du service) ou `aucun` (page sans cache).
- La fonction `regler_reglage_general` accepte alors oui ou non pour cette clé, gérant seulement, journalisé.
- L'écran l'affiche dans « Ce que le site propose aux clients ».
- Le libellé et l'aide sont lus par l'équipe, pas par les clients.

Migration : `20261130190000_interrupteurs_gestion.sql`.

## Route

- `POST /api/gestion/service`, `{ "type": "reglage-general", "cle": "alerte_email" | "plafond_codes_clients_jour" | "creneau_minutes" | "avance_jours" | "annulation_client_active", "valeur": … }`. Pour revenir à la variable, `valeur: null` sur l'e-mail.
- `GET /api/gestion/service` renvoie `generaux: { plafond_codes_clients_jour, creneau_minutes, avance_jours, alerte_email, annulation_client_active }`.

## Avant et après la migration

Avant la migration, `generaux` vaut null, l'enregistrement répond une erreur (aucun écran ne l'appelle) et les alertes partent à `ALERTE_EMAIL`. Après la migration, les valeurs restent celles d'aujourd'hui tant que le gérant n'y touche pas.

## Restent dans le code

Le téléphone (022 792 16 89) et l'adresse du restaurant figurent dans les pages légales, le JSON-LD, les e-mails et les messages du site : ce sont des faits validés par Jérémy (registre de faits). Les rendre réglables touche les textes de plusieurs sessions et le référencement. C'est à décider avec Jérémy, et ce n'est pas fait ici.
