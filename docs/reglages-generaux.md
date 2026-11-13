# Réglages généraux (vague 3, bo-operations)

Des valeurs que le gérant devait faire changer par un développeur. Migration `supabase/migrations/20261130130000_reglages_generaux.sql`, serveur `src/lib/reglages-generaux.ts`, route `/api/gestion/service` (gérant). Écran : back-office, rubrique « Réglages généraux » (`/gestion/reglages`, `src/components/gestion/GestionReglages.tsx`).

| Réglage | Départ | Bornes | Effet |
|---|---|---|---|
| E-mail des alertes | vide : la variable `ALERTE_EMAIL` de Netlify sert | une adresse e-mail | Commande pas acceptée, tablette muette, client absent, remboursement échoué : l'alerte part à cette adresse |
| Codes de connexion des clients par jour (`plafond_codes_clients_jour`) | 150 (décision de Jérémy du 12.11.2026) | de 20 à 450 | Au-delà, plus de code pour les clients jusqu'au lendemain. La boîte d'envoi est limitée à 500 e-mails par jour, confirmations comprises : d'où 450 au plus |
| Longueur d'un créneau (`creneau_minutes`) | 15 | 10, 15, 20 ou 30 | Heures proposées au client. La capacité par créneau compte par créneau : passer de 15 à 30 minutes double le temps couvert par la même capacité. Les commandes déjà prises hors de la nouvelle grille (19h15 après le passage à 30 minutes) ne comptent plus dans la capacité des créneaux voisins : changer un jour sans réservation, jamais pendant un service |
| Commande à l'avance (`avance_jours`) | 7 | de 0 à 14 jours | 0 : seulement le jour même |
| Rythme de la cuisine et des livraisons : pizzas et plats sortis en 15 minutes, livraisons d'un livreur en une heure, minutes en plus au plus, fourchettes annoncées | 0, 0, 0, 45, 15, 10 | 0 à 100 ; 0 à 20 ; 0 à 90 ; 0 à 60 | Heure promise réaliste (`docs/heure-reelle.md`). Débits à 0 : la file ou la livraison n'est pas comptée, en attente des chiffres de Jérémy (D8). L'écran montre la raison en cours |
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

## Alertes par type

Le gérant ne réglait que l'adresse qui reçoit les alertes. Il choisit désormais, type par type, les e-mails d'alerte qu'il reçoit : bloc « Alertes », « E-mails d'alerte envoyés ». P1 de `produit-gestion`. Migration `20261130260000_types_alertes.sql`, serveur `src/lib/alertes-types.ts`.

| Type | Envoyée par |
|---|---|
| Commande pas encore acceptée | surveillance, après le délai réglé dans Imprimantes |
| Tablette injoignable pendant le service | surveillance (pause automatique) |
| Ticket pas imprimé | imprimante (CloudPRNT) |
| Remboursement à refaire ou refusé par Stripe | tablette, annulation par le client, Stripe |
| Client absent à la livraison | téléphone du livreur |
| Réclamation d'un client | suivi de commande |
| E-mails : 80 % de la limite du jour | quota d'e-mails |
| Codes de connexion : plafond du jour atteint | connexion des clients ou de l'équipe |
| Adresse de l'équipe bloquée 24 heures | connexion de l'équipe |

- Tous sont envoyés au départ, comme avant. Décoché, un type n'envoie plus d'e-mail, mais sa copie reste en base (`courriels`, fournisseur `desactivee`) : rien ne se perd.
- `alerter(sujet, lignes, type, genre)` : le quatrième argument est le type réglable. Sans lui, l'alerte part toujours. Base absente ou en panne : envoyée, comme avant.
- Gérant seulement, journalisé (objet `type_alerte`). Route `/api/gestion/service` `{ type: "type-alerte", cle, actif }`.
- Tests : `tests/unit/types-alertes-sql.test.ts`, `types-alertes.test.ts`, `tests/e2e/gestion-reglages.spec.ts`.

## Mise en situation (13.11.2026)

Manques relevés par `produit-gestion`, migration `20261213140000_mise_en_situation_ops.sql`.

- **Connexion des livreurs par code (M3)** : Jérémy l'a voulue ouverte au lancement ; le chef a posé `connexion_livreur_par_code` à vrai en production le 13.11.2026. Le réglage devient une case du nouveau bloc « Équipe » de Réglages généraux (déclarée dans `interrupteurs_gestion`). La migration ne touche pas sa valeur. Le gérant ou le responsable touche « Code de connexion » à côté du livreur sur la tablette (onglet Livraisons). Le code fait 8 chiffres et vaut 10 minutes ; le livreur le tape sur son téléphone.
- **Adresse des alertes vide (M10)** : tant que `destinataireAlertes()` ne donne rien (« E-mail qui reçoit les alertes » vide et variable d’installation `ALERTE_EMAIL` absente, même règle que la Mise en route), l'accueil du back-office affiche « Aucune adresse ne reçoit les alertes », avec le lien vers les réglages (`src/lib/adresse-alertes.ts`, branché comme « Aucun livreur prévu »). La rubrique Mise en route de `bo-socle` a la même étape.
- **Four (M6)** : `debit_pizza_quart_heure` = 15 dans la base locale aussi (posé en production par le chef). La migration ne change que la valeur 0. L'aide de l'écran ne dit plus « en attente du chiffre de Jérémy » pour le four. Cuisine et livreurs restent à 0, à décider.

