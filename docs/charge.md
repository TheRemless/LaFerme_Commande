# Charge d'un vendredi soir

Mesuré le 13.11.2026 sur le Mac de développement, contre un build de production local qui tourne sur le jeu de rush (`docs/donnees-rush.md`). Rien n'a été envoyé vers une préversion ni vers Supabase : le script refuse toute adresse qui n'est pas ce poste.

## Lancer

```bash
npm run donnees:rush
```

```bash
BASE_LOCALE=1 BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npm run build && BASE_LOCALE=1 BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next start -p 3229
```

```bash
npm run charge:vendredi -- --site=http://localhost:3229 --minutes=5 --tablettes=15 --relecture=5
```

Options : `--minutes`, `--tablettes`, `--relecture` (secondes entre deux relectures d'une tablette), `--suivis` (clients qui suivent leur commande, page rafraîchie toutes les 20 s), `--livreurs` (15 s), `--back-offices` (30 s), `--commandes-heure` (commandes passées, payées par la doublure de paiement puis acceptées). Le script se connecte avec les comptes factices du jeu de rush. Les tablettes simulées renvoient la version de la file reçue (`?version=`, en-tête `X-Version-File`) comme la vraie tablette ; `--sans-version` mesure la file complète à chaque relecture.

## Résultats

Scénario « vendredi soir, Realtime en panne » : 15 tablettes qui relisent toutes les 5 s, 40 suivis, 5 livreurs, 2 back-offices, 60 commandes à l'heure. Trois passages de 5 minutes, machine partagée avec d'autres sessions (d'où l'écart d'un passage à l'autre).

| Route | Par seconde | Médiane | p95 | Taille |
|---|---|---|---|---|
| Tablette : file | 2,5 | 32 à 96 ms | 214 à 512 ms | 163 à 172 Ko |
| Tablette : livraisons | 2,5 | 39 à 105 ms | 230 à 575 ms | 4 Ko |
| Client : suivi | 1,3 à 1,9 | 10 à 63 ms | 201 à 807 ms | 13 Ko |
| Back-office : liste du jour | 0,05 | 14 à 44 ms | 58 à 534 ms | 38 à 41 Ko |
| Passer commande, payer, accepter | 0,01 | 8 à 165 ms | 62 à 324 ms | |

Aucune erreur sur 7 679 requêtes.

Scénario « trois fois un vendredi » : 45 tablettes toutes les 5 s, 120 suivis, 15 livreurs, 6 back-offices, 180 commandes à l'heure. 23 requêtes par seconde pendant 5 minutes, aucune erreur, p95 sous 330 ms pour toutes les routes (file 164 ms, suivi 327 ms), maximum 1,5 s.

Fonctions SQL appelées à chaque relecture de la tablette (instantané du jeu de rush, 20 appels) :

| Fonction | Médiane | Taille |
|---|---|---|
| `file_tablette` | 23 ms | 144 Ko |
| `livreurs_tablette` | 6 ms | 4 Ko |
| `plats_tablette` | 2 ms | 12 Ko |
| `charge_cuisine`, `etat_impression`, `manques_en_cours`, `commandes_en_retard`, `etat_coup_de_feu` | moins de 1 ms | moins de 1 Ko |

## Ce qu'on en retient

1. **Le site tient un vendredi soir, et trois fois plus, sur une seule machine.** Aucune erreur, aucune requête au-delà de 1,5 s.
2. **La file de la tablette est lourde : 160 à 185 Ko à chaque relecture**, et elle grossit au fil de la soirée. Elle renvoie toutes les commandes du jour, terminées comprises, avec leurs lignes. Une tablette toutes les 15 s : environ 40 Mo par heure ; sans Realtime (toutes les 5 s), environ 120 Mo par heure et par tablette. Piste (session `tablette`, déjà dans sa liste) : renvoyer seulement ce qui a changé, ou les terminées sans leurs lignes.
3. **`file_tablette` est la seule requête qui pèse** (23 ms en local). Les autres restent sous 7 ms. Aucun index manquant vu sur ces chemins.
4. Le suivi client (13 Ko) et le back-office restent légers.

## À mesurer sur la vraie infrastructure (avant l'ouverture, pas pendant un service)

Ce test ne dit rien du réseau : en local, la base est dans le même processus que le site.

- Temps de `/api/tablette/file` et du suivi entre Netlify et Supabase Zurich. Chaque relecture fait environ six appels à la base : à 20 ms aller-retour (Francfort et Zurich), cela fait plus de 100 ms ; avec des fonctions hors d'Europe, bien plus. Vérifier la région des fonctions Netlify (Francfort sur Pro).
- Connexions simultanées à Supabase Free puis Pro pendant 15 relectures par seconde.
- Bande passante Netlify et sortie de données Supabase d'un vrai samedi (point 2).
- Délai réel du signal Realtime entre une commande payée et la tablette.
