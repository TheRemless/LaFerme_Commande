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
