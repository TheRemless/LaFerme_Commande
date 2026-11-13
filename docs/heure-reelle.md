# Heure promise réaliste (vague 3, bo-operations)

Un vendredi à 19h50, le site annonçait « Chez vous vers 20h30 » avec un délai fixe (préparation habituelle, ou délai de la zone, plus le retard posé à la main). Le four avait 22 pizzas en file : la commande arrivait à 21h10. Désormais la file réelle de chaque poste allonge les heures annoncées. Une seule source pour tout le site : la config du service.

Migration `supabase/migrations/20261130100000_heure_reelle.sql`, calcul `charge_cuisine()` ; lecture `src/lib/config-service.ts` ; fourchette et raison `src/lib/heure-reelle.ts`.

## La règle (version 1)

1. **File d'un poste** (pizza, cuisine) : les articles des commandes nouvelles, acceptées ou en préparation, dues avant qu'une commande passée maintenant soit prête au plus tard. Une commande due depuis plus longtemps que l'allongement maximal (oubliée sur la tablette) ne compte pas. Une commande pour un créneau pas encore confirmée compte à l'heure de son créneau.
2. **Minutes de file** = articles ÷ débit du poste (articles par quart d'heure) × 15.
3. **Allongement** = ce que la plus longue file dépasse du délai de préparation habituel, arrondi aux 5 minutes au-dessus, plafonné.
4. L'allongement s'ajoute, comme le retard du soir, au délai de retrait et aux délais de chaque zone. Il ne décale pas l'ouverture avant le service.

Exemple : 22 pizzas en file, 8 par quart d'heure, cela fait 42 minutes de file. La préparation habituelle est de 20 minutes. Les heures annoncées prennent donc +25 minutes.

**Garde-fous.**
- Jamais plus tôt que le délai fixe d'aujourd'hui : l'allongement vaut 0 ou plus.
- Plafond réglable.
- `retard_minutes` reste le retard posé à la main : la tablette règle +5 et -5 à partir de lui, sans jamais y mêler l'allongement.

## Où l'heure change

Partout où le délai est lu, sans calcul en double :
- l'accueil (« dès que possible », dans le navigateur, avec la config servie par la page) ;
- les créneaux proposés ;
- le contrôle au paiement (`quandPossible`) ;
- l'heure proposée à la tablette à l'acceptation (`fileTablette`).

La config est relue au plus une fois par minute (cache existant).

## Réglages (tous marqués « proposition »)

| Réglage | Départ | Rôle |
|---|---|---|
| `debit_pizza_quart_heure` | 0 | Pizzas que le four sort en 15 minutes. 0 : poste non compté |
| `debit_cuisine_quart_heure` | 0 | Plats que la cuisine sort en 15 minutes. 0 : poste non compté |
| `allongement_max_minutes` | 45 | Allongement au plus |
| `fourchette_livraison_minutes` | 15 | Largeur de la fourchette annoncée en livraison |
| `fourchette_retrait_minutes` | 10 | Largeur de la fourchette annoncée au retrait |

Les débits restent à 0 tant que Jérémy n'a pas donné les vrais chiffres (question D8 du chef). D'ici là, rien ne change pour les clients. Les valeurs de l'exemple (8 pizzas par quart d'heure) ne servent qu'aux tests.

## Pour les autres sessions

- `config.reglages.allongement_minutes` : minutes ajoutées à cause de la file (déjà comprises dans `preparation_minutes` et les délais des zones).
- `config.reglages.charge` : détail par poste (`articles`, `file_minutes`, `compte`), `preparation_minutes`, `plafond_minutes`, `allongement_minutes`. Aucune donnée de client.
- `raisonCharge(charge)` : texte court pour la tablette et le back-office, par exemple « Four : 22 pizzas en file, 42 min. Heures annoncées +25 min. » ; `null` quand la file n'allonge rien.
- `fourchette(config, mode, minutes)` : `{ basse, haute }` autour de l'heure promise, arrondie aux 5 minutes, pour l'affichage client (`produit-client`, `client-commande`, `client-compte`).

## Avant et après la migration

Avant la migration, `charge_cuisine` n'existe pas. La config l'ignore et garde les heures du délai fixe. Après la migration, rien ne change tant que les débits valent 0.

## Version 2 (à venir)

- Livreurs présents ce soir (planning) et leurs tournées en cours.
- Allongement par poste, selon ce que contient le panier (au lieu de la plus longue file). Un four en panne ne retarderait alors plus un panier sans pizza.
- Articles déjà prêts à un poste. Il faut l'horodatage par poste que prépare la session `tablette`.
- Mesure sur le jeu de rush de `qualite`.
