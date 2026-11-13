# Heure promise réaliste (vague 3, bo-operations)

Un vendredi à 19h50, le site annonçait « Chez vous vers 20h30 » avec un délai fixe (préparation habituelle, ou délai de la zone, plus le retard posé à la main). Le four avait 22 pizzas en file : la commande arrivait à 21h10. Désormais la file réelle de chaque poste allonge les heures annoncées. Une seule source pour tout le site : la config du service.

Migrations `supabase/migrations/20261130100000_heure_reelle.sql` (calcul `charge_cuisine()`) et `20261130210000_charge_livraison.sql` (calcul `charge_livraison()`, version 2) ; lecture `src/lib/config-service.ts` ; fourchette et raison `src/lib/heure-reelle.ts`.

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

## La règle (version 2) : l'attente d'un livreur

Un soir, un seul livreur est là au lieu de deux et il a déjà quatre sacs. La cuisine suit, la livraison arrive en retard.

1. **Livreurs présents** : planning du service en cours (midi avant 15h à Genève, soir ensuite), c'est-à-dire la semaine type corrigée par les absences et les renforts du jour (rubrique Livreurs, `docs/planning-livreurs.md`). S'y ajoutent les livreurs qui ont reçu une livraison depuis deux heures : un planning tenu à moitié ne fait pas croire à un seul livreur. Un livreur désactivé ne compte pas.
2. **Livraisons** : commandes en livraison pas terminées (nouvelle, acceptée, en préparation, prête, partie), dues avant qu'une commande passée maintenant soit livrée au plus tard (délai de zone le plus long plus l'allongement maximal). Une livraison due depuis plus longtemps que l'allongement maximal ne compte pas.
3. **Attente d'un livreur** = livraisons ÷ (livreurs présents × livraisons qu'un livreur fait en une heure) × 60. Une livraison déjà partie compte pour moitié.
4. **Allongement des livraisons** = ce que l'attente dépasse de la préparation habituelle, arrondi aux 5 minutes au-dessus, plafonné comme la cuisine. En livraison, le plus long des deux (cuisine ou livreur) s'ajoute aux délais des zones. Le retrait ne suit que la cuisine.

Exemple : 1 livreur, 4 livraisons à faire, 3 livraisons par heure. L'attente est de 80 minutes, 60 de plus que la préparation. Les livraisons prennent +45 minutes (plafond), les retraits restent à l'heure habituelle si le four suit.

**Pas compté** (rien ne change pour les clients) tant que `livraisons_par_livreur_heure` vaut 0, ou si aucun livreur n'est prévu ce service ni n'a reçu de livraison depuis deux heures : un planning pas tenu ne doit pas fermer la livraison par erreur. L'écran des réglages le dit (« Livraisons pas comptées (aucun livreur prévu ce service) »).

## Où l'heure change

Partout où le délai est lu, sans calcul en double :
- l'accueil (« dès que possible », dans le navigateur, avec la config servie par la page) ;
- les créneaux proposés ;
- le contrôle au paiement (`quandPossible`) ;
- l'heure proposée à la tablette à l'acceptation (`fileTablette`).

La config est relue au plus une fois par minute (cache existant). L'accueil est lui-même en cache 60 secondes : l'heure qu'il affiche peut dater de deux minutes au plus. Le contrôle au paiement lit la config du serveur, vieille d'une minute au plus.

## Réglages (tous marqués « proposition » au départ)

Ils se règlent au back-office, rubrique « Réglages généraux », bloc « Rythme de la cuisine et des livraisons » (migration `20261130180000_reglages_rythme.sql`). On y voit aussi la raison en cours (« En ce moment : Four : 22 pizzas en file… »).

| Réglage | Départ | Rôle |
|---|---|---|
| `debit_pizza_quart_heure` | 0 | Pizzas que le four sort en 15 minutes. 0 : poste non compté |
| `debit_cuisine_quart_heure` | 0 | Plats que la cuisine sort en 15 minutes. 0 : poste non compté |
| `livraisons_par_livreur_heure` | 0 | Livraisons qu'un livreur fait en une heure, aller et retour compris (0 à 20). 0 : livraison non comptée |
| `allongement_max_minutes` | 45 | Allongement au plus, cuisine et livraison |
| `fourchette_livraison_minutes` | 15 | Largeur de la fourchette annoncée en livraison |
| `fourchette_retrait_minutes` | 10 | Largeur de la fourchette annoncée au retrait |

Les débits (four, cuisine, livreur) restent à 0 tant que Jérémy n'a pas donné les vrais chiffres (question D8 du chef). D'ici là, rien ne change pour les clients. Les valeurs de l'exemple (8 pizzas par quart d'heure) ne servent qu'aux tests.

## Pour les autres sessions

- `config.reglages.allongement_minutes` : minutes ajoutées à cause de la file (déjà comprises dans `preparation_minutes`).
- `config.reglages.allongement_livraison_minutes` : minutes ajoutées en livraison, le plus long de la file et de l'attente d'un livreur (déjà comprises dans les délais des zones). Jamais moins que `allongement_minutes`.
- `chargeDuMoment()` (`src/lib/heure-reelle-serveur.ts`, serveur seulement) : détail par poste (`articles`, `file_minutes`, `compte`), `preparation_minutes`, `plafond_minutes`, `allongement_minutes`, `allongement_livraison_minutes` et, si la base a la version 2, `livraison` (`livraisons`, `livreurs`, `attente_minutes`, `compte`). Aucune donnée de client ni nom de livreur, mais jamais dans une page publique : l'accueil sert la config au navigateur, et le nombre d'articles en cuisine minute par minute dirait les ventes du restaurant. Seulement dans une route qui a vérifié la session de l'équipe.
- `raisonCharge(charge)` : texte court pour la tablette et le back-office, par exemple « Four : 22 pizzas en file, 42 min. Heures annoncées +25 min. » ou « Livraison : 1 livreur pour 4 livraisons, 80 min. Livraisons +45 min (au plus), retraits à l'heure habituelle. » ; `null` quand rien n'allonge les heures.
- `fourchette(config, mode, minutes)` : `{ basse, haute }` autour de l'heure promise, arrondie aux 5 minutes, pour l'affichage client (`produit-client`, `client-commande`, `client-compte`).

## Avant et après la migration

Avant la migration, `charge_cuisine` n'existe pas. La config l'ignore et garde les heures du délai fixe. Après la migration, rien ne change tant que les débits valent 0. Même chose pour `charge_livraison` : absente, les livraisons suivent la cuisine seule.

## Version 3 (à venir)

- Allongement par poste, selon ce que contient le panier (au lieu de la plus longue file). Un four en panne ne retarderait alors plus un panier sans pizza.
- Ne pas compter dans sa file la commande dont on calcule l'heure (aujourd'hui, à l'acceptation, ses articles l'allongent un peu : prudent, jamais plus tôt).
- Articles déjà prêts à un poste. Il faut l'horodatage par poste que prépare la session `tablette`.
- Mesure sur le jeu de rush de `qualite`.
