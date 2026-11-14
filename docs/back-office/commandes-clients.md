# Commandes et clients au back-office (vague 3, session bo-commandes)

Documentation des PR de `bo-commandes` à partir des clients. Les premières sections (liste et fiche des commandes, modifier une commande, annulation par le client) sont dans [../back-office.md](../back-office.md).

## Clients, vague 3 : base et serveur (13.11.2026)

Migration `supabase/migrations/20261127120000_clients.sql`, aucun objet partagé recréé. Route : `/api/gestion/clients` (gérant, tout en POST, l'e-mail dans le corps). Tests : `tests/unit/clients-sql.test.ts`, `tests/unit/clients.test.ts`. L'écran viendra dans la rubrique `/gestion/clients` avec le kit du back-office.

- **Un client = un e-mail** (majuscules confondues), avec ou sans compte : les invités se retrouvent comme les autres. Rien n'est recopié : chiffres tirés des commandes à chaque lecture.
- **Liste** (`clients_gestion`, action `liste`) : prénom, nom et téléphone de la dernière commande, commandes servies, refusées, dépensé (remboursements déduits), panier moyen, première et dernière commande, compte, marque, notes. Recherche par téléphone, e-mail ou nom sur tout l'historique. Tri : dernière commande, dépensé, commandes, nom. Filtres : avec compte, marque, sans commande depuis N jours. Pagination côté serveur. Mesuré sur le jeu de rush (16 000 commandes, 2 000 clients) dans la base embarquée : de 35 à 64 ms par page, 189 ms pour un bout de téléphone de cinq chiffres.
- **Fiche** (`fiche_client_gestion`, action `fiche`) : chiffres, fréquence (jours entre deux commandes), livraisons et retraits, téléphones et adresses utilisés (une adresse comptée une fois), cinq plats préférés, cent dernières commandes, remboursements, notes, marque, compte.
- **Note interne** (`ajouter_note_client`, action `noter`) : gérant seulement, jamais montrée au client. Le journal note qui l'a écrite et quand, pas son texte (il ne survit pas à l'effacement).
- **Marque « à surveiller » ou « bloqué »** (`marquer_client`, action `marquer`) : **désactivée par défaut** (réglage `marque_client_active`, décision de Jérémy, D2). Gérant seulement, motif obligatoire, journalisée (`client`), se retire. Même activée, elle ne bloque rien d'elle-même : `client_marque(email, téléphone)` est prête pour le parcours de commande (marque retrouvée aussi par le téléphone), qui en décidera l'effet.
- **nLPD** : `donnees_gestion_client(email)` (notes et marque, pour l'export du client) et `effacer_notes_client(email)` (à la suppression du compte : notes, marque et lignes du journal qui les nomment ; la marque part avec le compte, décision de Jérémy du 13.11.2026, migration `20261213180000_marque_effacee_avec_compte.sql`), branchée par la session `client-compte`.

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
- **Geste** (gérant, un par réclamation). Décision de Jérémy (13.11.2026) : éviter les remboursements, proposer d'abord un geste pour la prochaine fois. Ordre proposé : plat offert, réduction, pas de geste, remboursement en dernier.
  - « Plat offert à la prochaine commande » : en attente sur le client (`gestes_en_attente(email)`) jusqu'à sa commande suivante. La fiche de cette commande le montre en tête de l'onglet « Gestes » (« Offert dans cette commande », `appliquer_geste`, action `offrir` de `/api/gestion/commandes`). La tablette peut lire la même liste (contrat proposé à la session `tablette`).
  - « Réduction sur la prochaine commande » : montant en francs ou pourcentage, choisi par le gérant (aucune valeur par défaut). Crée un code promo personnel `LAFERME-XXXXXXXX` (table `codes_promo` de `bo-carte`, colonnes `client_email`, `client_telephone`, `reclamation_id`) : une utilisation, sans date de fin, accepté seulement pour l'e-mail ou le téléphone du client (`evaluer_code` répond « inconnu » à tout autre). Le dossier montre le code et la commande où il a servi. Le gérant le donne au client (téléphone ou e-mail de réponse).
  - Les deux sont **désactivés par défaut** (réglage `gestes_commerciaux_actifs`, D3) ; la réduction attend aussi `codes_promo_actifs` (sans lui, le site ne propose pas de champ « Code »).
  - « Remboursement » relie un remboursement déjà fait par « Rembourser » sur la même commande ; « aucun » avec une raison.
  - Fiche d'une commande : tant qu'une réclamation attend son geste, l'onglet « Gestes » affiche « Avant de rembourser » et « Noter un geste », qui ouvre le dossier dans Clients, onglet Réclamations.
  - nLPD : codes personnels et plats offerts partent dans l'export du client ; à la suppression du compte, les plats offerts en attente et les codes pas encore utilisés sont effacés, un code déjà utilisé est éteint et détaché du client. Migration `20261213190000_geste_reduction.sql`.
- **Liste** (`reclamations_gestion`) : ouvertes d'abord, filtres état, type, période, commande ; compteurs par état. La fiche complète d'une commande liste ses réclamations.

## Changer les plats à la demande du client (décision du chef du 14.11.2026)

Jamais de débit sur la carte du client sans son accord sur le moment. Gérant, ou responsable de service (droit `modifier_commande`). Fiche de la commande, onglet « Gestes », « Changer les plats » (`src/components/gestion/commandes/ChangerPlats.tsx`), statuts nouvelle, acceptée, en préparation et prête.

- **Calcul** : `src/lib/difference.ts` recalcule tout depuis la base (`calculerPanier`), jamais depuis le navigateur. Valeur actuelle = plats + frais (`valeur_commande`). Différence = nouveau total − valeur actuelle. Ajouts et retraits ligne par ligne (même plat, mêmes options).
- **À encaisser** (comptoir, téléphone) : appliquée tout de suite, le total de la commande change.
- **Payée, moins chère** : appliquée ; remboursement de la différence (Stripe, ou espèces si payée au comptoir), ligne `remboursements` à la clé `modification-<id>`. Le total payé de la commande ne bouge pas : l'export voit la vente puis le remboursement, comme pour un remboursement après coup.
- **Payée, plus chère** : par défaut un lien de paiement Stripe de la différence (session de 30 minutes, métadonnées `type = complement`, `modification_id`), envoyé par e-mail si le client en a un, et affiché à copier. Rien ne change avant le paiement : le webhook (`confirmerComplement`, session et montant vérifiés en base, événement une seule fois) applique la modification et note le complément payé. Lien expiré ou paiement échoué : la modification est abandonnée. Repli au choix de l'équipe : complément à encaisser à la porte (livraison) ou au comptoir (retrait).
- **Compléments** (table `complements`, un seul modèle) : lien (moyen en ligne, encaissé au webhook), porte, comptoir. Encaissé en espèces ou par carte sur la page du livreur (`/api/livreur/complement`, sa livraison seulement) ou à la tablette (`/api/tablette/complement`). Clôture : encaissements par moyen, compléments à encaisser, écart « complement_sans_encaissement » dans « À vérifier ». Crésus : une vente de plus au jour de la commande, TVA au taux de la commande.
- **Tickets** (si les premiers sont sortis) : « AJOUT » aux postes concernés, seulement les lignes ajoutées ; une boisson ajoutée part au poste qui fait le sac. Retraits et complément sans ajout : « MODIFIÉE ». Complément à encaisser imprimé en négatif.
- **E-mails** (si le client en a un) : le lien du complément, puis la commande modifiée (ajouté, retiré, remboursé ou à payer).
- **Une modification à la fois** : une seconde attend que la première soit payée ou abandonnée (« Abandonner la modification » ferme le lien chez Stripe).
- **Doublure** : sans clé Stripe, le lien mène à `/paiement-test/complement/<id>`, qui simule le paiement par le même chemin que le webhook.
- **Argent reçu sans modification** (relectures de qualite et de sécurité) : un lien payé après l'abandon, sur une commande déjà partie, ou pour un autre montant passe en `payee_non_appliquee` (ou reste noté), et le gérant reçoit une alerte « Complément payé sans modification » pour rembourser depuis Stripe. « Abandonner » lit d'abord la session chez Stripe : déjà payée, l'abandon est refusé ; sinon le lien est fermé avant l'abandon. Un lien qui ne se crée pas abandonne la modification tout de suite.
- **Commande refusée ou annulée** après un complément payé par le lien : `rembourserCommande` rend aussi chaque complément sur son propre paiement (clé `complement-<id>`), noté `rembourse_le` ; un refus de Stripe alerte le gérant.
- **Frais actuels** : une nouvelle adresse dans une autre zone fait payer la différence de frais une seule fois (`frais_commande` lit ceux de la dernière modification appliquée ; la part de frais du complément va dans l'export).
- **Baisse après un complément encore dû** : le complément à encaisser se réduit d'abord, on ne rembourse pas ce qui n'est pas payé.
- **Commande changée entre-temps** (deux personnes en même temps) : refus « La commande a changé entre-temps », rien n'est enregistré.
- **Chiffres** (relecture de bo-pilotage) : les compléments comptent aussi dans `export_recap_jours`, `export_ventes` (une ligne « (complément) » sous la commande) et `pilotage_synthese` (ventes de la clôture et des rapports), jamais dans le compte des commandes. Migration `20261215140000_difference_compta.sql`. Le CSV de la clôture a ses lignes « Compléments ».
- **Limite connue** : rembourser plus tard un complément payé par le lien ne passe pas par l'écran (le remboursement après coup vise le paiement de départ, et son plafond ne compte que lui). Il se fait depuis Stripe.
- Base : migration `20261215130000_difference.sql` (tables `modifications_commande` et `complements` ; recrées : `livraisons_livreur`, `file_tablette`, `cloture_rapport`, `export_cresus`). Tests : `tests/unit/difference-sql.test.ts`, `tests/unit/difference.test.ts` (webhook signé), `tests/e2e/gestion-difference.spec.ts`.

## Responsable de service (D1, oui de Jérémy le 13.11.2026)

Le responsable n'agit qu'avec le réglage `role_responsable_actif` à vrai ; sans lui, tout reste au gérant. Liste de bo-socle, tableau dans `src/lib/personnel/droits.ts`.

| Route | Ouvert au responsable | Reste au gérant |
|---|---|---|
| `/api/gestion/commandes` | `voir_commandes` : options_filtres, liste_page, liste, jours, fiche, fiche_complete, courriel ; `rembourser` ; `modifier_commande` : modifier ; `annuler_apres_prete` : annuler | noter, recreer, heure, reimprimer, renvoyer_courriel, offrir |
| `/api/gestion/clients` | `voir_commandes` : liste, fiche | noter, marquer |
| `/api/gestion/reclamations` | `voir_commandes` : liste, fiche | ouvrir, suivre, geste |

- Base : `demander_remboursement` passe de `gerant_nom` à `auteur_droit(…, 'rembourser')` (migration `20261213200000_responsable_commandes.sql`) ; refus `droit_refuse`, traduit « Réservé au gérant. ». `modifier_commande` et `annuler_commande_partie` passent par la PR de tablette (`20261213220000`).
- Écran : `useDroit` et `useRoleGestion` (`src/components/gestion/droits.tsx`) cachent au responsable la note, l'heure, la réimpression (une à une et en lot), le renvoi d'un e-mail, « Recréer », le plat offert, la réclamation à noter, le geste et le suivi du dossier, la marque. Le serveur revérifie toujours.
- Tests : `tests/unit/responsable-commandes-sql.test.ts`, `tests/e2e/gestion-responsable-commandes.spec.ts` (comptes `responsable-commandes-{bureau,mobile}@laferme.test`).

## Écrans (vague 3)

- `/gestion/commandes` (`src/components/gestion/commandes/`) : liste paginée côté serveur avec pastilles de statut, fiche en panneau (contenu au prix payé, chronologie, e-mails, notes, gestes, réclamations). Tests : `tests/e2e/gestion-commandes.spec.ts`. Captures : `docs/rendus/vague-3/bo-commandes/commandes-apres-*`.
- `/gestion/clients` (`src/components/gestion/clients/`) : onglets « Clients » (liste, fiche, notes, marque désactivée) et « Réclamations » (liste, dossier, geste, clôture). Tests : `tests/e2e/gestion-clients.spec.ts`. Captures : `docs/rendus/vague-3/bo-commandes/clients-apres-*`, `reclamations-apres-*` et `gestes-*` (`scripts/audit/captures-bo-gestes.mjs`).
- Correctif `supabase/migrations/20261211100000_fiche_client_adresse.sql` : la fiche d'un client plantait si une de ses commandes à emporter avait une adresse en JSON null (commandes passées par le site).
- Liste des commandes : filtre « avec réclamation ouverte » et colonne « Réclamations » (migration `20261211110000_liste_commandes_reclamations.sql`, qui recrée `liste_commandes_gestion`) ; gestes en lot « Réimprimer » et « Annuler… » (un motif, une confirmation, chaque commande par le même geste qu'une à une, `src/components/gestion/commandes/ActionsLot.tsx`).
- Liste des commandes : filtres service (midi avant 15h à Genève, sur l'heure prévue ou l'heure de la commande), zone, livreur et montant à l'écran, repliés sous « Filtres » sur téléphone ; `options_filtres_commandes()` (action `options_filtres`) donne zones et livreurs.
- Liste des commandes, retours du chef de produit : colonne « Jour » dès que la liste couvre plus d'un jour ; filtre « Remboursement » (fait, en cours, en échec ; migration `20261212130000_liste_commandes_remboursement.sql`) ; filtres et période repliés au départ ; filtres lisibles depuis l'adresse, jamais une recherche : `?statut=nouvelle,acceptee`, `?periode=aujourdhui|hier|7jours|30jours|mois|mois-dernier`, `?du=AAAA-MM-JJ&au=AAAA-MM-JJ` (un an au plus), `?moyen=en_ligne|comptoir`, `?paiement=paye|a_encaisser_retrait|encaisse|rembourse`, `?remboursement=fait|en_cours|echec`, `?service=midi|soir`, `?mode=livraison|retrait`, `?en_retard=1`, `?avec_reclamation=1`, `?avec_note=1`. Une valeur inconnue est ignorée ; dès que l'adresse porte un filtre, le panneau des filtres s'ouvre. Exemples pour les alertes de l'accueil : `/gestion/commandes?remboursement=echec&periode=30jours`, `/gestion/commandes?moyen=comptoir&paiement=a_encaisser_retrait&du=2026-11-01&au=2026-11-10`.

