# Codes promo (vague 3, bo-carte)

Construits complets mais **désactivés**. L'offre (type, taux, dates, supports) est une décision de Jérémy : voir `docs/lancement/offre-premiere-commande.md`. Aucun montant n'est écrit dans le code ni dans la base.

Migration `supabase/migrations/20261210120000_codes_promo.sql`. Tests : `tests/unit/codes-promo-sql.test.ts` (base), `tests/unit/codes-promo.test.ts` (saisie, textes). Serveur : `/api/gestion/promotions` (gérant). Écran : rubrique « Promotions » après la coque du back-office.

## Ce qui existe

- **Interrupteur général** : réglage `codes_promo_actifs`, faux. Tant qu'il l'est, aucun code ne s'applique et le site ne montre pas de champ « Code ».
- **Un code** : le code tapé (3 à 20 lettres, chiffres ou tirets, sans tenir compte des majuscules), le support (nom interne : « Flyer automne »), le type (pourcentage des plats, montant fixe plafonné au total des plats, livraison offerte), le minimum de plats, les dates de début et de fin (heure de Genève), le plafond d'utilisations, « première commande seulement », « une fois par client ». Il naît inactif : on l'active à part.
- **Un code par support** pour savoir lequel ramène des commandes : `codes_gestion()` donne, par code, les commandes, la remise accordée et le total encaissé.
- **Après un premier usage**, le type et la valeur d'un code ne changent plus (on en crée un autre) : les chiffres restent justes.

## Commande

`commandes.code_promo` et `commandes.remise_centimes` (0 sans code, migration `20261210180000_codes_promo_commande.sql`) gardent le code et la remise avec la commande, pour le reçu, l'e-mail et l'export. Le total vaut plats + frais − remise. Une ligne de `utilisations_codes` relie la commande au code (chiffres par code, abus).

## Contrôles (base, `evaluer_code`)

La remise est calculée par la base à partir de ce qu'elle a, jamais d'un montant envoyé par le navigateur. « Une fois par client » et « première commande » se vérifient sur l'e-mail (sans majuscules ni étiquette `+`), le téléphone (079…, +41…, 0041… sont le même) et l'adresse de livraison (bâtiment du registre fédéral). Au panier, le client n'est pas encore connu : avec `provisoire`, la remise est annoncée et marquée `a_verifier`, puis tout est revérifié au paiement. Ne comptent que les commandes payées, à encaisser, encaissées, ou en cours de paiement depuis moins de 30 minutes. Une commande refusée, annulée ou dont le paiement a échoué rend le code au client.

Textes montrés au client (`src/lib/codes-promo.ts`, passés par `redaction-fr`) : « Ce code n'existe pas. Vérifiez l'orthographe. », « Ce code n'est plus valable. » (aussi quand le plafond est atteint), « Ce code n'est pas encore valable. », « Ce code vaut à partir de CHF … de plats. », « Vous avez déjà utilisé ce code. », « Ce code vaut pour une première commande. », « Ce code vaut pour une livraison. ».

## Limite connue

Au retrait, en invité, l'e-mail et le téléphone ne sont pas prouvés : un client qui en invente d'autres peut reprendre un code « une fois par client » ou « première commande ». En livraison, l'adresse officielle du registre fédéral bloque la reprise. C'est la conséquence de la commande sans compte (décision fixée), à peser par Jérémy avec l'offre choisie.

## Pas encore branché (PR suivante, avec `client-commande` et `bo-pilotage`)

- Champ « Code » au panier et `?code=` dans l'adresse du QR (le code seul, jamais une donnée du client).
- Remise dans le calcul du panier et revérifiée au paiement ; montant Stripe après remise ; `noter_utilisation_code` dans la même transaction que la commande.
- Ligne « Remise » sur le reçu, l'e-mail de confirmation et le suivi ; ticket de cuisine inchangé.
- Remboursements cohérents avec la remise ; export comptable : la remise réduit la base imposable (à faire confirmer par la fiduciaire).
- Règles pour ce branchement (revue de sécurité) : passer à `evaluer_code` l'adresse officielle rendue par `zoneServeur` (avec `featureId`), jamais celle du corps de la requête ; prendre `sous_total_centimes`, `frais_centimes` et `mode` du calcul du serveur ; appeler `noter_utilisation_code` avec la `remise_centimes` rendue par `evaluer_code`, dans la même transaction que la commande.
