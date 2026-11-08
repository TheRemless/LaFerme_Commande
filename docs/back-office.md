# Back-office (lot 7b)

Adresse : `/gestion` (non indexée). Réservé au rôle `gerant` de la table `personnel`, même connexion par code que la tablette. Un membre « service » voit « Réservé au gérant ».

## Ce qu'on y fait

| Rubrique | Contenu |
|---|---|
| Carte | Par plat : nom, description, prix et case « Prix validé », commandable, station (imprimante pizza ou cuisine), photo (shooting pro seulement), provenance affichée, provenances à fournir, allergènes, retraits gratuits à valider. Chaque plat montre ce qui bloque la mise en ligne |
| Suppléments et pâtes | Prix, validation et « proposé » de chaque supplément et choix |
| Livraison et horaires | Zones (frais, minimum, délais, ouverte), horaires par service, fermetures. Enregistrer une valeur la valide : elle n'est plus une « proposition » |
| Importer le tableau | `docs/validation-carte.xlsx` rempli : aperçu avant et après, avertissements (plat inconnu, valeur illisible), puis application d'un bloc |
| Export comptable | CSV des ventes encaissées sur une période, total par taux de TVA, sans données personnelles |
| Journal | Toutes les modifications : qui, quand, avant et après |

## Règles

- Un prix changé sans cocher « Prix validé » repart à valider. Le build de production reste bloqué tant qu'un plat commandable a un prix, un allergène, une provenance, un supplément ou des retraits à valider.
- L'import ne lit que les cases jaunes. Une case vide ne change rien. Tout passe ou rien ne passe.
- Les textes affichés aux clients (noms, descriptions, provenances, allergènes) sont ceux que le gérant saisit. Le site n'en invente aucun.
- Chaque écriture passe par une fonction SQL qui vérifie que l'auteur est un gérant actif, puis journalise.

## Pas encore fait

- Modifier la liste des NPA d'une zone (lecture seule pour l'instant).
- Ajouter un plat ou une catégorie (la carte vient du tableau de validation).
- Gérer les membres du personnel (SQL, voir `docs/tablette.md`).
