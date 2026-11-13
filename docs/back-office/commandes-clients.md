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

## Gestes du back-office sur une commande

Base et serveur, 13.11.2026. Serveur : `src/lib/actions-gestion.ts`, actions `heure`, `annuler`, `reimprimer` et `renvoyer_courriel` de `/api/gestion/commandes` (gérant). Migration `supabase/migrations/20261127140000_renvoyer_courriel.sql`. Tests : `tests/unit/actions-gestion.test.ts`. L'écran viendra avec le kit (boutons de la fiche).

- **Changer l'heure, annuler, réimprimer** : mêmes chemins que la tablette (`agir()`, inchangée). Mêmes contrôles en base, mêmes e-mails au client, et, à l'annulation d'une commande déjà acceptée, ticket « ANNULÉE » aux postes qui ont déjà leur ticket. Une commande payée en ligne est remboursée en entier, une seule fois. L'état affiché (`de`) est revérifié : si la commande a changé entre-temps, rien ne se fait.
- **Renvoyer un e-mail** (« je n'ai rien reçu ») : un e-mail déjà envoyé pour cette commande, renvoyé tel quel à l'adresse de la commande, avec le sujet suivi de « (nouvel envoi) ». Il compte dans le quota du jour comme un e-mail de suivi.
- **Journal** : chaque geste réussi est noté au journal du back-office (objet `commande_action`), en plus de l'historique de la commande.

## Réclamations et gestes commerciaux

Base et serveur, 13.11.2026.

Migration `supabase/migrations/20261127130000_reclamations.sql`, aucun objet partagé recréé (réutilise `equipe_nom` de `bo-operations`). Routes : `/api/gestion/reclamations` (gérant) et `POST /api/suivi/reclamation` (client, depuis son suivi ; formulaire de la session `client-compte`). Tests : `tests/unit/reclamations-sql.test.ts`, `tests/unit/reclamations.test.ts`. L'écran viendra avec le kit (rubrique Réclamations, et un bloc dans la fiche de la commande).

- **Ouvrir** : l'équipe (service ou gérant) depuis la commande, source téléphone, sur place ou e-mail ; type retard, manquant, froid, erreur, qualité, livraison ou autre ; description. Le client depuis son suivi : commande acceptée ou terminée, dans les 14 jours, trois réclamations au plus par commande ; le restaurant reçoit une alerte par e-mail (numéro et type seulement).
- **Suivre** (gérant) : fil du dossier (chaque mot, chaque changement d'état), « en cours », « close » avec une résolution obligatoire, rouvrir. Journalisé (`reclamation`).
- **Geste** (gérant, un par réclamation) : « remboursement » relie un remboursement déjà fait par « Rembourser » sur la même commande ; « aucun » avec une raison ; « plat offert à la prochaine commande » **désactivé par défaut** (réglage `gestes_commerciaux_actifs`, décision de Jérémy, D3). Activé, il reste en attente sur le client (`gestes_en_attente(email)`, pour la tablette et la fiche) jusqu'à ce que l'équipe l'applique à sa commande suivante (`appliquer_geste`). Aucun avoir en francs : il attend les codes de `bo-carte` et l'export de `bo-pilotage`.
- **Liste** (`reclamations_gestion`) : ouvertes d'abord, filtres état, type, période, commande ; compteurs par état. La fiche complète d'une commande liste ses réclamations.

## Écrans (vague 3)

- `/gestion/commandes` (`src/components/gestion/commandes/`) : liste paginée côté serveur avec pastilles de statut, fiche en panneau (contenu au prix payé, chronologie, e-mails, notes, gestes, réclamations). Tests : `tests/e2e/gestion-commandes.spec.ts`. Captures : `docs/rendus/vague-3/bo-commandes/commandes-apres-*`.
- `/gestion/clients` (`src/components/gestion/clients/`) : onglets « Clients » (liste, fiche, notes, marque désactivée) et « Réclamations » (liste, dossier, geste, clôture). Tests : `tests/e2e/gestion-clients.spec.ts`. Captures : `docs/rendus/vague-3/bo-commandes/clients-apres-*` et `reclamations-apres-*`.
- Correctif `supabase/migrations/20261211100000_fiche_client_adresse.sql` : la fiche d'un client plantait si une de ses commandes à emporter avait une adresse en JSON null (commandes passées par le site).
- Liste des commandes : filtre « avec réclamation ouverte » et colonne « Réclamations » (migration `20261211110000_liste_commandes_reclamations.sql`, qui recrée `liste_commandes_gestion`) ; gestes en lot « Réimprimer » et « Annuler… » (un motif, une confirmation, chaque commande par le même geste qu'une à une, `src/components/gestion/commandes/ActionsLot.tsx`).
- Liste des commandes : filtres service (midi avant 15h à Genève, sur l'heure prévue ou l'heure de la commande), zone, livreur et montant à l'écran, repliés sous « Filtres » sur téléphone ; `options_filtres_commandes()` (action `options_filtres`) donne zones et livreurs.

