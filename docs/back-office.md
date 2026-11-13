# Back-office (lot 7b)

Adresse : `/gestion` (non indexée). Réservé au rôle `gerant` de la table `personnel`, même connexion par code que la tablette. Un membre « service » voit « Réservé au gérant ».

## Ce qu'on y fait

| Rubrique | Contenu |
|---|---|
| Commandes | Les 7 derniers jours (commandes, ventes, remboursé, refusées, comptoir pas encore encaissé). Recherche par nom, téléphone ou numéro (90 jours) ou par période. Fiche d'une commande : lignes, historique, remboursements, et « Rembourser » (montant et motif) après « Prête », « Partie » ou « Terminée » |
| Carte | Par plat : nom, description, prix et case « Prix validé », commandable, catégorie, station (imprimante pizza ou cuisine), options proposées (suppléments, choix des pâtes), photo (envoyée ou choisie dans le shooting), provenance affichée, provenances à fournir, allergènes, retraits gratuits à valider. Chaque plat montre ce qui bloque la mise en ligne. « Ajouter un plat », « Archiver ce plat » et « Remettre à la carte », « Changer l'ordre » des plats d'une catégorie, « Catégories et leur ordre » (ajouter, renommer, réordonner) |
| Plat du jour | Nom, description, prix, poste, provenance, allergènes, jour et service (midi, soir ou les deux). En tête de la carte ce jour-là, disparaît seul ensuite. Liste des plats du jour à venir et des sept derniers jours |
| Suppléments et pâtes | Prix, validation et « proposé » de chaque supplément et choix. Ajouter un supplément à un groupe existant |
| Livraison et horaires | Zones (frais, minimum, délais, ouverte), communes de chaque zone, horaires par service, fermetures (journées entières ou un seul service), ouvertures exceptionnelles, délai de préparation habituel, plafond du paiement au comptoir, commandes au plus par créneau (livraisons, retraits ; 0 sans limite), tickets des commandes à l'avance (minutes avant l'heure promise, de 15 à 240 : 60 pour une livraison, 30 pour un retrait). Enregistrer une valeur la valide : elle n'est plus une « proposition » |
| Équipe | Ajouter un membre (prénom, e-mail, accès « Tablette » ou « Tablette et back-office »), changer son accès, le déconnecter de tous ses appareils, le retirer (accès coupé tout de suite), remettre un ancien membre. Il reste toujours au moins un gérant |
| Importer le tableau | `docs/validation-carte.xlsx` rempli : aperçu avant et après, avertissements (plat inconnu, valeur illisible), puis application d'un bloc |
| Export comptable | CSV des ventes encaissées sur une période, puis les remboursements faits sur la période (en négatif, au jour du remboursement), puis le total net par taux de TVA, sans données personnelles |
| Journal | Toutes les modifications : qui, quand, avant et après. « Annuler » remet l'ancienne valeur (prix, supplément, zone, commune, horaire, fermeture, ouverture, réglage) si rien n'a changé depuis |

## Règles

- Un prix changé décoche « Prix validé ». Enregistré sans le recocher, il repart à valider : un plat qui était en vente au prix validé sort de la vente et y revient seul quand le prix est validé (audit de sécurité 2, S2-02). Un prix à 0 est refusé. Le build de production reste bloqué tant qu'un plat commandable a un prix, un allergène, une provenance, un supplément ou des retraits à valider.
- L'import ne lit que les cases jaunes. Une case vide ne change rien. Tout passe ou rien ne passe.
- Les textes affichés aux clients (noms, descriptions, provenances, allergènes) sont ceux que le gérant saisit. Le site n'en invente aucun.
- Chaque écriture passe par une fonction SQL qui vérifie que l'auteur est un gérant actif, puis journalise.
- Remboursement après coup (audit du gérant, G02) : la base réserve le montant (jamais plus que le total, une ligne par geste, clé envoyée par l'écran), puis Stripe rembourse avec la même clé d'idempotence. Un double appui ou une reprise après coupure ne rembourse pas deux fois. Un échec Stripe ne compte pas. Au comptoir, le rendu en espèces est noté. Le client reçoit le montant et le motif par e-mail (paiement en ligne).
- Recherche de commandes en POST : un nom ou un téléphone n'apparaît jamais dans une adresse.

## Carte sans développeur (16.11.2026)

Migration `supabase/migrations/20261116090000_carte_gestion.sql`. Tests : `tests/unit/carte-gestion-sql.test.ts` (base), `tests/unit/carte-gestion.test.ts` (serveur et photos), `tests/e2e/gestion-carte.spec.ts` (écrans). Captures : `docs/rendus/carte-gestion/`.

- **Plat ajouté.** Il naît hors de la vente (`origine = 'gestion'`). Il ne peut être en vente que si `motifs_plat` est vide : mêmes motifs que la vue `plats_bloquants` (prix à valider, allergènes manquants, provenance à fournir, supplément à valider, retraits à valider), qui est désormais construite sur cette même fonction. Un déclencheur sur `plats` le revérifie à chaque mise en vente ou changement d'un de ces champs (une rupture posée sur la tablette passe toujours). Les plats de la carte d'origine gardent leur comportement d'avant.
- **Slug.** Tiré du nom, sans accent. S'il existe déjà, ou s'il apparaît dans une commande passée, la base ajoute -2, -3 : « recommander » ne retombe jamais sur un autre plat.
- **Archiver.** `archive_le` rempli et `commandable` faux (contrainte en base). Rien n'est supprimé : les lignes de commande copient déjà nom, poste et prix, l'export comptable ne lit que les commandes. Un plat archivé quitte la carte, la tablette et la liste principale du back-office.
- **Catégories.** Le slug ne change jamais (liens `#pizzas`). Une catégorie sans plat en vente ne s'affiche pas aux clients. La catégorie `plat-du-jour` est réservée : toujours en tête (ordre 0), ni renommée, ni réordonnée, aucun plat de la carte n'y entre.
- **Plat du jour.** Un plat comme les autres (`origine = 'jour'`, colonnes `jour` et `jour_service`), donc imprimé, mis en rupture et compté comme les autres. Son prix vaut dès la saisie (décision de Jérémy du 12.11.2026) : `prix_a_valider` reste faux, même après un changement de prix. Les allergènes restent exigés pour la mise en vente. La vue `carte_publique` ne le montre que le jour dit (heure de Genève). Le serveur refuse au panier et au paiement un plat du jour pour un autre jour ou un autre service (remise avant 15h : midi, après : soir ; `src/lib/plat-du-jour.ts`). Date de aujourd'hui à 14 jours.
- **Photos envoyées.** Voir ci-dessous.
- **Cache.** Chaque écriture vide le cache du catalogue et les pages `/carte` et `/panier` (`rafraichirCaches`), comme un changement de prix.
- **Import du tableau.** Il retrouve un plat par son nom, sinon par le slug que donne le nom écrit dans le tableau : un tableau rempli avant un changement de nom reste valable. Un plat ajouté au back-office n'est pas dans `validation-carte.xlsx`.
- **Noms harmonisés (12.11.2026).** Majuscule aux onze pizzas listées dans `docs/audits/noms-a-harmoniser.md`, « Saint-Jacques », « e » à l'italienne dans trois noms de pâtes. Migration de données (le nom seulement, slugs inchangés) et `docs/carte-proposee.json` puis `supabase/seed.sql` régénéré. `scripts/carte_proposee.py` garde les noms d'Uber : ne plus le relancer sans reporter ces noms.

### Photos envoyées

Choix du stockage : **dans la base Postgres** (table `photos_plats`), servies par le site à l'adresse `/photos/<id>.jpg`.

1. Rien à régler chez Supabase ni chez Netlify : pas de seau Storage à créer, pas de règle d'accès à écrire, pas d'image distante à autoriser pour `next/image`.
2. Même chemin en local, dans les tests et en ligne : la base embarquée le fait tourner, l'envoi est vérifié de bout en bout sans Supabase.
3. Écriture par le serveur seulement : la table n'a aucun droit pour `anon` ni `authenticated`, les fonctions sont réservées à `service_role` et revérifient le gérant.
4. Poids raisonnable : une photo réenregistrée pèse de 200 à 600 Ko. Cent plats tiennent dans 60 Mo, loin des 500 Mo de la base gratuite et des 8 Go du plan Pro. Les sauvegardes de la base les emportent avec la carte.
5. Le nom change à chaque envoi : le fichier se garde un an dans le cache de Netlify et du navigateur (`immutable`), la base n'est lue qu'au premier affichage. `next/image` en tire les tailles de chaque écran comme pour les photos du shooting.

Contrôles : gérant connecté et requête du site ; 5 Mo au plus (Netlify refuse plus de 6 Mo, le navigateur réduit la photo avant l'envoi) ; type lu dans les premiers octets (JPEG, PNG, WebP, AVIF), jamais d'après le nom ; 50 millions de pixels au plus ; au moins 1200 × 900 après recadrage. Le serveur décode, tourne selon l'appareil, recadre en 4:3 au centre, réduit à 2133 × 1600 (taille des photos du shooting) et réenregistre en JPEG qualité 80. Les métadonnées (lieu GPS, appareil) disparaissent. La base vérifie encore la signature JPEG. Une photo remplacée ou retirée est effacée de la base et l'adresse répond 404.

Le module d'image `sharp` est déclaré dans `package.json` et se construit pour Linux sur Netlify. Le back-office n'étant pas ouvert sur les préversions, `/api/diagnostic/images` (préversions seulement) réduit une image générée avec le même code et répond `{ "ok": true, "taille": "2133x1600" }` quand tout marche.

## Disponibilités et ruptures planifiées (vague 3, 13.11.2026)

Migration `supabase/migrations/20261128090000_disponibilites.sql`. Tests : `tests/unit/disponibilites-sql.test.ts` (base), `tests/unit/disponibilite.test.ts` (contrôle et saisie). L'écran arrive après la nouvelle coque du back-office : en attendant, le serveur accepte déjà les actions `disponibilite` et `rupture` de `/api/gestion/carte`.

- **Disponibilités.** Un plat de la carte peut être réservé à un service (midi ou soir), à un mode (livraison ou à emporter) et à certains jours de la semaine (colonnes `dispo_service`, `dispo_mode`, `dispo_jours` ; vide = sans restriction, sept jours cochés = tous les jours). Le plat du jour garde sa date et son service, seul le mode s'y règle. Le serveur refuse au panier et au paiement un plat pris hors de ses disponibilités, d'après le créneau et le mode choisis (`src/lib/disponibilite.ts`, appelé par `erreurPlatsDuJour`). Motifs montrés au client : « Seulement le soir. », « Seulement à emporter. », « Seulement le vendredi et le samedi. ».
- **Rupture planifiée.** `rupture_jour` (plats et options) se lit « épuisé jusqu'au » cette date comprise, d'aujourd'hui à 60 jours. La tablette y met toujours aujourd'hui ; le back-office peut mettre une date plus lointaine. Le plat revient seul le lendemain. « Remettre » sur la tablette lève aussi une rupture planifiée. Un plat épuisé jusqu'au jeudi 19 novembre reste commandable pour un créneau du vendredi 20 ; pour un créneau d'ici jeudi, le client lit « Épuisé. De retour le vendredi 20 novembre. ». Une option épuisée l'est jusqu'à sa date, quel que soit le jour choisi.
- **Poste ou catégorie entière** (four en panne). Table `ruptures_groupees` : cible `poste:pizza`, `poste:cuisine` ou `categorie:<slug>`, épuisée jusqu'à une date comprise (aujourd'hui pour une panne). Tous ses plats sont épuisés pour le client et sur la tablette (`rupture_groupee` dit pourquoi), panier et paiement les refusent. La lever ne remet pas un plat épuisé seul avant. Tout membre actif peut la poser ou la lever (`regler_rupture_groupee`, le bouton de service est à la tablette) ; le back-office l'envoie par l'action `rupture_groupee`.
- **Journal.** Objets `disponibilite`, `rupture`, `rupture_option` et `rupture_groupee` (un gérant ; un membre du service est noté dans `journal_personnel`), avec la valeur d'avant et d'après. Ils ne s'annulent pas depuis le journal : on règle de nouveau la disponibilité ou on remet le plat.

## Pas encore fait

- Créer un nouveau groupe d'options (autre que les suppléments de pizza et le choix des pâtes).
- Supprimer une catégorie vide (elle reste invisible des clients tant qu'elle n'a aucun plat en vente).

## Vague 2 (16.11.2026, audit du gérant)

- Communes d'une zone : ajouter (ou déplacer) un couple NPA et localité, ou le retirer, journalisé. La zone d'une adresse reste décidée par le serveur à partir de l'adresse officielle du registre fédéral : rien ne change pour la triche sur la zone.
- Fermer un seul service (`fermetures.service`), ouvrir un jour non prévu (table `ouvertures`, lisible par tous comme les horaires). Une ouverture remplace les horaires habituels du même service ce jour-là. Effet immédiat sur les créneaux proposés.
- Avant une fermeture, le back-office donne les numéros des commandes déjà prises sur la période (G15).
- Retour arrière (`annuler_journal`) : refusé si la valeur a changé depuis, refait par les mêmes fonctions que l'écran, ligne d'origine marquée « annulée ». L'équipe, les remboursements, l'import et les imprimantes ne s'annulent pas.
- La contrainte `journal_gestion_objet_check` est un contrôle de forme (`objet ~ '^[a-z_]{2,30}$'`) et plus une liste fermée.
