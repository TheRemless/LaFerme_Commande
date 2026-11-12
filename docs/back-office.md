# Back-office (lot 7b)

Adresse : `/gestion` (non indexée). Réservé au rôle `gerant` de la table `personnel`, même connexion par code que la tablette. Un membre « service » voit « Réservé au gérant ».

## Ce qu'on y fait

| Rubrique | Contenu |
|---|---|
| Commandes | Les 7 derniers jours (commandes, ventes, remboursé, refusées, comptoir pas encore encaissé). Recherche par nom, téléphone ou numéro (90 jours) ou par période. Fiche d'une commande : lignes, historique, remboursements, et « Rembourser » (montant et motif) après « Prête », « Partie » ou « Terminée » |
| Carte | Par plat : nom, description, prix et case « Prix validé », commandable, station (imprimante pizza ou cuisine), photo (shooting pro seulement), provenance affichée, provenances à fournir, allergènes, retraits gratuits à valider. Chaque plat montre ce qui bloque la mise en ligne |
| Suppléments et pâtes | Prix, validation et « proposé » de chaque supplément et choix |
| Livraison et horaires | Zones (frais, minimum, délais, ouverte), communes de chaque zone, horaires par service, fermetures (journées entières ou un seul service), ouvertures exceptionnelles, délai de préparation habituel, plafond du paiement au comptoir, commandes au plus par créneau (livraisons, retraits ; 0 sans limite). Enregistrer une valeur la valide : elle n'est plus une « proposition » |
| Équipe | Ajouter un membre (prénom, e-mail, accès « Tablette » ou « Tablette et back-office »), changer son accès, le déconnecter de tous ses appareils, le retirer (accès coupé tout de suite), remettre un ancien membre. Il reste toujours au moins un gérant |
| Importer le tableau | `docs/validation-carte.xlsx` rempli : aperçu avant et après, avertissements (plat inconnu, valeur illisible), puis application d'un bloc |
| Export comptable | CSV des ventes encaissées sur une période, puis les remboursements faits sur la période (en négatif, au jour du remboursement), puis le total net par taux de TVA, sans données personnelles |
| Journal | Toutes les modifications : qui, quand, avant et après. « Annuler » remet l'ancienne valeur (prix, supplément, zone, commune, horaire, fermeture, ouverture, réglage) si rien n'a changé depuis |

## Règles

- Un prix changé sans cocher « Prix validé » repart à valider. Le build de production reste bloqué tant qu'un plat commandable a un prix, un allergène, une provenance, un supplément ou des retraits à valider.
- L'import ne lit que les cases jaunes. Une case vide ne change rien. Tout passe ou rien ne passe.
- Les textes affichés aux clients (noms, descriptions, provenances, allergènes) sont ceux que le gérant saisit. Le site n'en invente aucun.
- Chaque écriture passe par une fonction SQL qui vérifie que l'auteur est un gérant actif, puis journalise.
- Remboursement après coup (audit du gérant, G02) : la base réserve le montant (jamais plus que le total, une ligne par geste, clé envoyée par l'écran), puis Stripe rembourse avec la même clé d'idempotence. Un double appui ou une reprise après coupure ne rembourse pas deux fois. Un échec Stripe ne compte pas. Au comptoir, le rendu en espèces est noté. Le client reçoit le montant et le motif par e-mail (paiement en ligne).
- Recherche de commandes en POST : un nom ou un téléphone n'apparaît jamais dans une adresse.

## Pas encore fait

- Ajouter un plat ou une catégorie (la carte vient du tableau de validation).

## Vague 2 (16.11.2026, audit du gérant)

- Communes d'une zone : ajouter (ou déplacer) un couple NPA et localité, ou le retirer, journalisé. La zone d'une adresse reste décidée par le serveur à partir de l'adresse officielle du registre fédéral : rien ne change pour la triche sur la zone.
- Fermer un seul service (`fermetures.service`), ouvrir un jour non prévu (table `ouvertures`, lisible par tous comme les horaires). Une ouverture remplace les horaires habituels du même service ce jour-là. Effet immédiat sur les créneaux proposés.
- Avant une fermeture, le back-office donne les numéros des commandes déjà prises sur la période (G15).
- Retour arrière (`annuler_journal`) : refusé si la valeur a changé depuis, refait par les mêmes fonctions que l'écran, ligne d'origine marquée « annulée ». L'équipe, les remboursements, l'import et les imprimantes ne s'annulent pas.
- La contrainte `journal_gestion_objet_check` est un contrôle de forme (`objet ~ '^[a-z_]{2,30}$'`) et plus une liste fermée.
