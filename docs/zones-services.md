# Zones par service et zone fermée jusqu'à une heure (vague 3, bo-operations)

Avant, une zone était livrée à tous les services ou à aucun. Deux réglages s'ajoutent. Migration `supabase/migrations/20261130110000_zones_services.sql`, serveur `src/lib/zones-operations.ts`, logique `src/lib/service.ts`.

| Réglage | Qui | Exemple | Effet pour le client |
|---|---|---|---|
| Services de la zone (`services`) | gérant | Zone 3 le soir seulement | À midi, l'adresse est reconnue mais « dès que possible » n'est pas proposé. Le premier moment offert est le soir. Les créneaux du midi ne sont ni proposés ni acceptés au paiement |
| Zone fermée jusqu'à une heure (`fermee_jusqu_a`, `fermee_motif`) | équipe (tablette ou back-office) | Neige, zone 2 fermée jusqu'à 21h | La zone est fermée jusqu'à l'heure dite, puis rouvre seule. Les autres zones et le retrait continuent |

- **Rouvrir avant l'heure** : « Rouvrir » (équipe). Une fermeture déjà finie n'a rien à rouvrir.
- **Bornes** :
  - fermeture : de maintenant à sept jours au plus. Au-delà, on décoche « Zone ouverte » au back-office ;
  - motif : de 2 à 120 caractères. Il est lisible par tous, comme les frais et les délais, et il est prévu pour être montré au client. N'y écrire que ce qu'un client peut lire (« Neige »), jamais un nom ni une raison personnelle (« Marco malade ») ;
  - au moins un service par zone.
- **Contrôles** : le gérant pour les services, l'équipe (`service` ou `gerant`) pour fermer et rouvrir. La base les revérifie, les livreurs n'y ont pas accès.
- **Journal** : objets `zone_services` (avant et après) et `zone_fermeture` (heure et motif ; `apres` vide pour une réouverture).
- **Où c'est lu** : avec la zone, dans la config du service (lecture publique de `zones_livraison`). Les mêmes fonctions pures servent dans le navigateur (accueil) et sur le serveur (adresse, panier, paiement). La fermeture se compare à l'heure réelle, comme la pause : l'heure simulée des préversions ne la lève pas.
- **Commande à l'avance pendant une fermeture** : refusée tant que la fermeture dure, même pour le lendemain (la zone est fermée). Elle redevient possible à la réouverture.

## Route du back-office

`POST /api/gestion/service` (gérant), en plus des types existants :

- `{ "type": "zone-services", "numero": 3, "services": ["soir"] }`
- `{ "type": "zone-fermer", "numero": 2, "jusqua": "2026-11-20T20:00:00.000Z", "motif": "Neige" }`
- `{ "type": "zone-rouvrir", "numero": 2 }` : `deja: true` si plus rien n'était fermé.

`GET /api/gestion/service` renvoie, dans chaque zone, `services`, `fermee_jusqu_a` et `fermee_motif`.

La tablette ferme et rouvre une zone par sa propre route, sur `fermerZone` et `rouvrirZone` de `src/lib/zones-operations.ts`.

## Pour les écrans du client (`client-commande`)

`zonePour()` renvoie maintenant `{ statut: "zone-fermee", zone, jusqua, motif }` pour une zone fermée jusqu'à une heure. L'accueil et `/api/adresse` traitent encore toute zone fermée comme « hors zone ». La phrase à afficher, par exemple « La livraison à Carouge reprend à 21h », est à écrire avec `redaction-fr` et à valider par Jérémy.

## Avant et après la migration

Avant la migration, les colonnes n'existent pas : `services` est absent, ce qui veut dire les deux services, et `fermee_jusqu_a` vaut null. Rien ne change. Après la migration, chaque zone vaut midi et soir, sans fermeture.

## Écran du back-office

Rubrique « Livraison et horaires », dans chaque fiche de zone (`src/components/gestion/ZoneOperations.tsx`) :
- **Livrée** : « Midi » et « Soir », un toucher change le service (case noire : livrée). Au moins un service : pour ne plus livrer une zone, décocher « Zone ouverte à la livraison » ;
- **Fermer cette zone pour quelques heures** : le jour, l'heure de réouverture et un motif lu par les clients, puis une confirmation. La fiche montre ensuite « Fermée jusqu'à… » et « Rouvrir maintenant ».

Captures : `docs/rendus/vague-3/bo-operations/horaires-zone-fermee-1024.png`.

## Pas encore fait

Le bouton de la tablette (session `tablette`).

## Tester une adresse

Rubrique Livraison et horaires, sous les zones. On saisit une adresse et l'écran montre ce que le site répondrait maintenant à un client qui la donne. Rien n'est enregistré ni journalisé.

- **Avec la rue** : l'adresse est cherchée dans le registre fédéral, comme au paiement, et l'adresse officielle s'affiche. **Sans la rue** : seuls le NPA et la localité comptent, comme à l'accueil quand le client choisit sa commune.
- **Livrée** : zone, frais, commande minimum, délai annoncé en ce moment (retard du soir et allongement compris), services livrés aujourd'hui, puis l'état de la livraison (dès que possible et l'heure, ou le premier créneau, la pause, la fermeture).
- **Fermée** : jusqu'à quelle heure et pour quel motif, ou « Zone ouverte à la livraison » décochée. **Hors zone** : retrait seulement.
- Même calcul que le site (`zoneServeur`, `zonePour` et `etatService`), sur la même config. Serveur `src/lib/simulateur-adresse.ts`, route `/api/gestion/service` `{ type: "simuler-adresse", adresse }` (gérant). L'adresse passe dans le corps de la requête, jamais dans l'URL.
- Tests : `tests/unit/simulateur-adresse.test.ts`, `tests/e2e/gestion-service-v3.spec.ts`. Capture : `docs/rendus/vague-3/bo-operations/horaires-tester-adresse-1024.png`.

