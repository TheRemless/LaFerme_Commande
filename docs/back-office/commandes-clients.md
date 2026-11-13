# Commandes et clients au back-office (vague 3, session bo-commandes)

Documentation des PR de `bo-commandes` à partir des clients. Les premières sections (liste et fiche des commandes, modifier une commande, annulation par le client) sont dans [../back-office.md](../back-office.md).

## Clients, vague 3 : base et serveur (13.11.2026)

Migration `supabase/migrations/20261127120000_clients.sql`, aucun objet partagé recréé. Route : `/api/gestion/clients` (gérant, tout en POST, l'e-mail dans le corps). Tests : `tests/unit/clients-sql.test.ts`, `tests/unit/clients.test.ts`. L'écran viendra dans la rubrique `/gestion/clients` avec le kit du back-office.

- **Un client = un e-mail** (majuscules confondues), avec ou sans compte : les invités se retrouvent comme les autres. Rien n'est recopié : chiffres tirés des commandes à chaque lecture.
- **Liste** (`clients_gestion`, action `liste`) : prénom, nom et téléphone de la dernière commande, commandes servies, refusées, dépensé (remboursements déduits), panier moyen, première et dernière commande, compte, marque, notes. Recherche par téléphone, e-mail ou nom sur tout l'historique. Tri : dernière commande, dépensé, commandes, nom. Filtres : avec compte, marque, sans commande depuis N jours. Pagination côté serveur. Mesuré sur le jeu de rush (16 000 commandes, 2 000 clients) dans la base embarquée : de 35 à 64 ms par page, 189 ms pour un bout de téléphone de cinq chiffres.
- **Fiche** (`fiche_client_gestion`, action `fiche`) : chiffres, fréquence (jours entre deux commandes), livraisons et retraits, téléphones et adresses utilisés (une adresse comptée une fois), cinq plats préférés, cent dernières commandes, remboursements, notes, marque, compte.
- **Note interne** (`ajouter_note_client`, action `noter`) : gérant seulement, jamais montrée au client. Le journal note qui l'a écrite et quand, pas son texte (il ne survit pas à l'effacement).
- **Marque « à surveiller » ou « bloqué »** (`marquer_client`, action `marquer`) : **désactivée par défaut** (réglage `marque_client_active`, décision de Jérémy, D2). Gérant seulement, motif obligatoire, journalisée (`client`), se retire. Même activée, elle ne bloque rien d'elle-même : `client_marque(email, téléphone)` est prête pour le parcours de commande (marque retrouvée aussi par le téléphone), qui en décidera l'effet.
- **nLPD** : `donnees_gestion_client(email)` (notes et marque, pour l'export du client) et `effacer_notes_client(email)` (à la suppression du compte : notes et lignes du journal qui les nomment), à brancher par la session `client-compte`. La marque reste après la suppression du compte (proposition : supprimer son compte ne doit pas lever un blocage).
