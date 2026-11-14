# Carte gérée au back-office, vague 3 (bo-carte)

Ce que le gérant règle sur la carte depuis la vague 3, côté base et serveur. Les écrans arrivent avec la nouvelle coque du back-office. Les règles de la vague 2 (plats ajoutés, archivage, catégories, photos, plat du jour) restent dans [back-office.md](back-office.md).

## Disponibilités et ruptures planifiées (vague 3, 13.11.2026)

Migration `supabase/migrations/20261210090000_disponibilites.sql`. Tests : `tests/unit/disponibilites-sql.test.ts` (base), `tests/unit/disponibilite.test.ts` (contrôle et saisie). L'écran arrive après la nouvelle coque du back-office : en attendant, le serveur accepte déjà les actions `disponibilite` et `rupture` de `/api/gestion/carte`.

- **Disponibilités.** Un plat de la carte peut être réservé à un service (midi ou soir), à un mode (livraison ou à emporter) et à certains jours de la semaine (colonnes `dispo_service`, `dispo_mode`, `dispo_jours` ; vide = sans restriction, sept jours cochés = tous les jours). Le plat du jour garde sa date et son service, seul le mode s'y règle. Le serveur refuse au panier et au paiement un plat pris hors de ses disponibilités, d'après le créneau et le mode choisis (`src/lib/disponibilite.ts`, appelé par `erreurPlatsDuJour`). Motifs montrés au client : « Seulement le soir. », « Seulement à emporter. », « Seulement le vendredi et le samedi. ».
- **Rupture planifiée.** `rupture_jour` (plats et options) se lit « épuisé jusqu'au » cette date comprise, d'aujourd'hui à 60 jours. La tablette y met toujours aujourd'hui ; le back-office peut mettre une date plus lointaine. Le plat revient seul le lendemain. « Remettre » sur la tablette lève aussi une rupture planifiée. Un plat épuisé jusqu'au jeudi 19 novembre reste commandable pour un créneau du vendredi 20 ; pour un créneau d'ici jeudi, le client lit « Épuisé. De retour le vendredi 20 novembre. ». Une option épuisée l'est jusqu'à sa date, quel que soit le jour choisi.
- **Poste ou catégorie entière** (four en panne). Table `ruptures_groupees` : cible `poste:pizza`, `poste:cuisine` ou `categorie:<slug>`, épuisée jusqu'à une date comprise (aujourd'hui pour une panne). Tous ses plats sont épuisés pour le client et sur la tablette (`rupture_groupee` dit pourquoi), panier et paiement les refusent. La lever ne remet pas un plat épuisé seul avant. Tout membre actif peut la poser ou la lever (`regler_rupture_groupee`, le bouton de service est à la tablette) ; le back-office l'envoie par l'action `rupture_groupee`.
- **Choix obligatoire épuisé.** Quand un groupe obligatoire n'a plus assez d'options disponibles (plus de penne ni de spaghetti), le plat est épuisé pour le client (« Épuisé pour aujourd'hui. ») et refusé au panier et au paiement. `motifPlat` (`src/lib/plat-du-jour.ts`) donne ce motif comme tous les autres, la carte affiche le même texte que le refus du serveur. La tablette liste aussi les options des choix obligatoires (`options_tablette`, champ `obligatoire`).
- **Journal.** Objets `disponibilite`, `rupture`, `rupture_option` et `rupture_groupee` (un gérant ; un membre du service est noté dans `journal_personnel`), avec la valeur d'avant et d'après. Ils ne s'annulent pas depuis le journal : on règle de nouveau la disponibilité ou on remet le plat.

## Groupes d'options (vague 3, 13.11.2026)

Migration `supabase/migrations/20261210100000_groupes_options.sql`. Tests : `tests/unit/groupes-options-sql.test.ts`. Écran après la coque ; le serveur accepte déjà les actions `nouveau_groupe`, `groupe`, `defauts`, `ordre_options`, `renommer_option` et `plats_du_groupe` de `/api/gestion/carte`.

- **Groupe neuf** (sauce au choix, cuisson, accompagnement) : nom, minimum (0 à 10) et maximum (1 à 20). Il naît sans option ni plat : on lui ajoute ses options (« Ajouter un supplément » existant), puis la liste des plats qui le portent. Un même groupe se pose sur autant de plats qu'on veut ; changer un prix d'option le change partout.
- **Ticket** : un groupe à choix obligatoire et unique (minimum 1, maximum 1) s'imprime `CHOIX`, les autres `+`, comme aujourd'hui.
- **Garde-fous** : un minimum que les options proposées ne remplissent pas est refusé dès qu'un plat en vente porte le groupe ; un plat ajouté au back-office et en vente ne reçoit pas un groupe dont un prix reste à valider (même verrou que sa fiche).
- **Options cochées d'avance** (`options.par_defaut`) : au plus le maximum du groupe, le client peut les décocher. L'affichage sur la fiche du client est à `client-commande`.
- **Nom et ordre des options** : renommer garde les commandes passées intactes (le nom choisi y est copié).
- **Journal** : objets `groupe`, `groupe_defauts`, `groupe_ordre`, `groupe_plats`, `option_nom`. Ils ne s'annulent pas depuis le journal.

## Prix en lot et copie d'un plat (vague 3, 13.11.2026)

Migration `supabase/migrations/20261210110000_prix_en_lot.sql`. Tests : `tests/unit/prix-en-lot-sql.test.ts`. Écran après la coque ; le serveur accepte déjà les actions `prix_en_lot` et `dupliquer` de `/api/gestion/carte`.

- **Prix en lot** : une catégorie entière ou une liste de plats, et une règle (nouveau prix pour chacun, hausse ou baisse en pour cent, ou en francs), arrondie à 5, 10, 50 centimes ou au franc. La base calcule les nouveaux prix à partir des siens. Aperçu d'abord (avant et après, rien n'est écrit), puis application : tout passe ou rien ne passe. Chaque plat changé est journalisé comme un changement de prix fait à la main, donc annulable plat par plat. Sans « Prix validé », les prix changés repartent à valider. Un plat ajouté au back-office et en vente exige « Prix validé », dès l'aperçu. Plats archivés et plats du jour exclus.
- **Copier un plat** (« Pizza Tonno grande ») : même catégorie, poste, description, prix, provenance, allergènes, disponibilités, options et retraits ; hors de la vente jusqu'à ce qu'on la mette en vente. Elle se range juste après son modèle. Une photo envoyée n'est pas copiée (elle disparaît avec son plat), une photo du shooting l'est. Journal : `plat_ajoute`, avec le plat d'origine.

## Étiquettes des plats (vague 3, 13.11.2026)

Migration `supabase/migrations/20261210150000_etiquettes.sql`. Tests : `tests/unit/etiquettes-sql.test.ts`. Action `etiquettes` de `/api/gestion/carte` ; écran avec la nouvelle carte du back-office.

- Trois étiquettes : végétarien, végane, épicé. Le gérant les pose plat par plat ; le site n'en déduit aucune (ni de la description, ni des allergènes). Sans saisie, aucune étiquette : le restaurant confirme chaque plat. Végane ajoute végétarien.
- La carte publique les donne (`carte_publique.etiquettes`) pour le filtre et la fiche, affichés par `client-commande`.
- Journal : objet `etiquettes`, avant et après.

## Poste d'un plat : four, cuisine ou comptoir (vague 3, 14.11.2026)

Décision de Jérémy du 14.11.2026 : l'équipe du comptoir met boissons et desserts prêts dans le sac.

- **Trois postes.** Fiche d'un plat, nouveau plat et plat du jour : champ « Poste » (four, cuisine, comptoir) avec une aide d'une ligne. La liste a une colonne « Poste », cachée par défaut. Valeurs en base : `pizza`, `cuisine`, `comptoir` (enum `station`, migration 20261215150000).
- **Comptoir.** Pas de ticket de préparation (`ticketsDeCommande` ne crée de tâche que pour le four et la cuisine), pas de ligne dans `commande_postes` (déclencheur recréé dans 20261215151000), aucun débit : `charge_cuisine()` ne compte que `pizza` et `cuisine`. L'article apparaît seulement sur le ticket du sac et sur l'écran comptoir (session tablette).
- **Boissons au comptoir** par la migration 20261215151000 (catégorie `boissons`, y compris les boissons ajoutées au back-office). Les desserts restent où ils sont : Jérémy choisit plat par plat. Les commandes déjà passées gardent le poste figé sur leurs lignes. `docs/carte-proposee.json` et `supabase/seed.sql` suivent.
- **Règle des pizzas du soir.** Un panier « pizzas seulement » peut aussi contenir des articles au comptoir (une boisson ne demande pas la cuisine), mais il lui faut au moins une pizza (`pizzasSeulement`, `src/lib/postes-plat.ts`). Sur la carte, à l'heure des pizzas seules, les articles au comptoir restent commandables.
- **Ruptures.** « Four en panne » ne touche que le four ou la cuisine : un article au comptoir n'est épuisé que par sa catégorie ou un à un.
- Tests : `tests/unit/poste-comptoir.test.ts` (enum, boissons, desserts intacts, choix au back-office et journal, `commande_postes`, charge, règle des pizzas, tickets), `tests/e2e/gestion-carte.spec.ts` (« le poste se choisit par plat »).

## Écran : la carte en liste (vague 3)

Rubrique `/gestion/carte`, onglet « Liste » (par défaut). Code : `src/components/gestion/carte/` (liste, prix en lot, parties de la fiche), sur le kit du back-office. Test : `tests/e2e/gestion-carte-liste.spec.ts`. Captures : `docs/rendus/vague-3/bo-carte/`.

- **Voir ce qui manque d'un coup.** Les boutons en haut filtrent et comptent : Tous, En vente, Hors vente, Épuisés, Bloquent la mise en ligne (les plats en vente de la vue `plats_bloquants`), Prix à valider, Sans photo, Sans allergènes, Archivés. La colonne « À compléter » dit en un mot ce qui manque à chaque plat (prix, allergènes, provenance, suppléments, retraits, photo). La recherche lit le nom et la description ; la liste « Catégorie » restreint.
- **Changer un prix sur place.** Toucher le prix dans la ligne, écrire, puis Entrée (ou toucher ailleurs). Échap rend l'ancien. Un prix changé ainsi repart à valider.
- **Gestes en lot.** Cocher des plats, puis : « Changer les prix » (en pour cent ou en francs, hausse ou baisse, arrondi, aperçu avant et après, puis « Appliquer »), « Valider les prix », « Épuiser jusqu'au… » (une date), « Fin de l'épuisement », « Mettre en vente », « Retirer de la vente », « Archiver » (confirmation). La carte d'été se prépare ainsi : plats copiés ou ajoutés hors de la vente, puis le jour venu « Mettre en vente » sur les nouveaux et « Retirer de la vente » ou « Archiver » sur les anciens.
- **Fiche d'un plat.** Toucher son nom : la fiche s'ouvre sur le côté (plein écran sur téléphone). En plus de la fiche habituelle : disponibilités (midi, soir, livraison, à emporter, jours), rupture jusqu'à une date avec « Remettre en vente », et « Copier ce plat ».
- **Étiquettes** (végétarien, végane, épicé) : sur la fiche, à cocher seulement si le restaurant l'a vérifié ; colonne « Étiquettes » dans « Colonnes ».
- **Four en panne** (contrôle du 13.11.2026). Bouton « Four en panne… » en haut : tout le poste pizza, tout le poste cuisine ou une catégorie, épuisé jusqu'à une date comprise (aujourd'hui par défaut), par l'action `rupture_groupee`. Chaque rupture en cours s'affiche en tête de la carte, cadre d'encre, avec « Remettre en vente ». Les plats épuisés un par un le restent quand on la lève. La tablette a le même geste en service, sur la même fonction (`regler_rupture_groupee`). La fonction revérifie le rôle en base (migration 20261212150000) : service, gérant, responsable tant que le rôle est activé ; un livreur est refusé (`droit_refuse`). Test : `tests/unit/rupture-groupee-role.test.ts`.
- **Commandes touchées.** Après « Épuiser » (fiche d'un plat, « Épuiser jusqu'au… » en lot, « Four en panne »), le panneau liste les commandes à accepter, acceptées ou en préparation qui contiennent ces plats, du jour jusqu'à la date de retour : numéro, état, mode, heure, lignes touchées, et un lien qui ouvre la fiche dans la rubrique Commandes (rien dans l'adresse). Fonction `commandes_touchees(p_slugs, p_cible, p_jusqu_au)`, lecture seule, sans nom ni téléphone ; action `commandes_touchees` de `/api/gestion/carte`. Test : `tests/unit/commandes-touchees-sql.test.ts`.
- **Au téléphone**, la liste montre le nom avec l'état et ce qui manque dessous, puis le prix ; les autres colonnes se lisent dans la fiche.
- **Ajouter un plat** : bouton en haut à droite ; la fiche du plat créé s'ouvre aussitôt.
- **Envoyer des photos** (plusieurs d'un coup, 40 au plus) : l'écran propose le plat d'après le nom du fichier (`pizza-tonno.jpg`, « Pizza Tonno.png »), on corrige si besoin, on choisit le cadrage (haut, centre, bas) puis « Envoyer ». Chaque photo passe par le même contrôle qu'un envoi seul. Le cadrage existe aussi sur la fiche d'un plat.
- La liste lit la carte déjà chargée par le back-office (une centaine de plats au plus) : filtres et tri se font dans le navigateur, 50 lignes par page. L'export CSV donne les colonnes affichées.

## Écran : les groupes d'options (vague 3)

Rubrique `/gestion/supplements`. Code : `src/components/gestion/carte/Groupes.tsx`. Test : `tests/e2e/gestion-groupes.spec.ts`. Capture : `docs/rendus/vague-3/bo-carte/b-groupe-reglage.png`.

- « Nouveau groupe » : nom vu par le client, minimum (0 pour un choix facultatif) et maximum. Le panneau de réglage s'ouvre aussitôt ; les options s'ajoutent sous le groupe, comme les suppléments.
- « Régler le groupe » : nom et règles, options cochées d'avance, ordre et noms des options, option épuisée jusqu'à une date (avec « Remettre »), plats qui proposent le groupe (cases par catégorie, « tous » pour une catégorie entière). Retirer le groupe de plats demande confirmation.
- Un groupe obligatoire qui n'a pas assez d'options proposées ne se pose sur aucun plat : l'écran le refuse et dit pourquoi.

