# Textes publics du site (lot 8a)

Relecture du 8.11.2026 avec `redaction-fr` (registre de faits et fiche de voix de Giuseppe). Tous les textes vus par un client ont été relevés : accueil, carte, fiche plat, panier, commande, suivi, compte, messages d'erreur et courriels. La tablette et le back-office (personnel seulement) ne sont pas concernés.

Résultat du script de vérification : 0 point bloquant (virgule avant « et », tiret d'incise, deux-points). Les motifs signalés sont de vraies questions de formulaire (« Pour quand ? ») et des listes de champs, pas des tics d'écriture.

## Faits affirmés au client, et leur source

| Ce que le site dit | Source |
|---|---|
| Restaurant La Ferme, Route de Chancy 132, 1213 Onex | Registre de faits |
| 022 792 16 89 | Registre de faits (confirmé le 29.10.2026) |
| Livraison « par les livreurs du restaurant » | Décision de Jérémy, `docs/PROMPT.md` §2, ajoutée au registre le 8.11.2026 |
| Paiement en ligne par TWINT ou carte, au comptoir pour un retrait | Décision de Jérémy, `docs/PROMPT.md` §2 |
| « Allergènes : demandez-nous au 022 792 16 89 » | Décision de Jérémy, `docs/PROMPT.md` §5 |
| Provenances | Seulement celles saisies dans la base (back-office ou tableau de validation) |
| Zones, frais, minimums, délais, horaires | Lus dans la base, jamais écrits en dur. Marqués « proposition » sur les préversions tant qu'ils ne sont pas validés |
| Prix | Base seulement |

Aucun « fait maison », aucun des faits interdits du registre (four napolitain, 450 °C, chêne, banquets, tram, tiramisù maison, mot du patron).

## Changé dans ce lot

- « Le livreur vous appelle s'il ne trouve pas l'entrée » et « On vous appelle si la commande a du retard » : deux promesses que le restaurant n'a pas faites. Remplacées par « Pour vous joindre au sujet de la commande. »
- « TWINT, carte, Apple Pay ou Google Pay » devient « TWINT ou carte bancaire » : Apple Pay et Google Pay dépendent du réglage du compte Stripe, à confirmer à son ouverture.

## À valider par Jérémy

- Après suppression d'un compte, les commandes déjà passées restent dans la comptabilité du restaurant (phrase de l'espace client). À confirmer avec la fiduciaire et à écrire dans la déclaration de confidentialité (lot 8b).
- Apple Pay et Google Pay : à rajouter au texte si Stripe les active.
