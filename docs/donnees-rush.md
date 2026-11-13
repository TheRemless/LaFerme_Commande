# Jeu de données de rush (base embarquée)

Pour vérifier un écran ou une requête avec les volumes d'un vrai restaurant, pas avec trois commandes. Tout reste sur ta machine : le script ne parle jamais à Supabase et refuse de tourner si une variable de connexion à une vraie base est présente (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `NETLIFY`, `CONTEXT`…).

## En deux commandes

```bash
npm run donnees:rush
```

```bash
BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next dev -p <ton port>
```

Le script fait une base neuve (migrations de ta branche, amorçage, données de test), la remplit en une quinzaine de secondes, puis l'enregistre dans `.pglite/rush.tar.gz` (environ 23 Mo, hors du dépôt). Le site la charge au démarrage par `BASE_LOCALE_INSTANTANE`, déjà prévu dans `src/lib/db/locale.ts`. Sans `.env.local` dans le worktree, sinon le site lit Supabase.

Build de production local : `BASE_LOCALE=1 BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npm run build`, puis la même chose avec `npm start -- -p <ton port>`.

## Ce qu'il y a dedans

| Quoi | Volume |
|---|---|
| 30 derniers jours | environ 300 commandes par jour ouvert (mardi à samedi), 60 à l'heure le vendredi et le samedi soir entre 19h et 21h |
| Historique | un an allégé (environ 40 commandes par jour, sans événements ni tournées), deux semaines de vacances fermées |
| Aujourd'hui | la journée jusqu'à « maintenant » ; hors service, une file en direct d'une heure à 60 commandes à l'heure (à accepter, en préparation, prêtes, parties) |
| À l'avance | une vingtaine de commandes sur créneau pour les sept jours qui suivent |
| Clients | 2 000 (150 fidèles, 450 réguliers), deux sur trois avec un compte et leurs adresses |
| Paiements | en ligne (Stripe de test, `cs_test_rush_…`) et au comptoir (sous le plafond), échecs et paiements abandonnés, retraits au comptoir jamais encaissés |
| Refus et remboursements | refus de la tablette remboursés, manques remboursés au prix payé (Stripe, espèces), gestes commerciaux, remboursements en échec ou en cours |
| Livraisons | cinq livreurs factices, tournées de une à trois commandes par zone, clients absents |
| Postes | avancement par poste (pizza, cuisine) des commandes des 30 derniers jours : lancé, prêt, marqué à la main (`tablette:Prénom`) ou déduit du statut. Le poste pizza traîne le vendredi et le samedi vers 20h (goulot visible dans les Rapports) |
| Carte | deux plats et un supplément en rupture aujourd'hui |
| Back-office | journal (ruptures, retard, horaires, remboursements) des 30 derniers jours |

Comptes factices pour se connecter en local (le code s'affiche à l'écran) : `gerant.rush@exemple.test` (gérant), `lea.rush@exemple.test`, `tom.rush@exemple.test`, `yanis.rush@exemple.test` (service), `alba.rush@exemple.test` et quatre autres livreurs. Les clients sont en `prenom.nom@exemple.test`, téléphones en `+41 00 000 …`, rues inventées (« Rue du Rush », « Chemin des Essais »…) dans les NPA des zones actives.

## Options

```bash
npm run donnees:rush -- --maintenant=2026-11-13T19:45 --graine=7 --echelle=0.1 --sortie=.pglite/petit.tar.gz
```

- `--maintenant` : heure de Genève de référence. Par défaut l'heure actuelle au quart d'heure, ce qui est presque toujours le bon choix : les écrans comparent les heures à l'horloge réelle.
- `--graine` : même graine et même `--maintenant`, mêmes données. Le script affiche une empreinte du contenu pour le vérifier.
- `--echelle` : 1 = volumes complets ; 0,1 pour un essai rapide.

## À savoir

- **Refaire le jeu chaque jour** (les ruptures, la file en direct et « aujourd'hui » dépendent de la date) et **après chaque migration** ajoutée ou rebasée : l'instantané contient les migrations du moment où il a été fait.
- Les montants passent par le vrai calcul du panier (`src/lib/panier.ts`) sur la carte de la base : aucun prix n'est écrit dans le script.
- Pas encore dans le jeu : courriels envoyés, tâches d'impression et imprimantes, sessions et codes de connexion.
- Les tables arrivées avec une migration récente (postes, par exemple) ne sont remplies que si la migration est là : le script marche avant comme après.
- Code : `scripts/donnees-rush.ts` (lanceur et refus), `scripts/rush/` (génération), test `tests/unit/donnees-rush.test.ts`.
- Charge d'un vendredi soir sur ce jeu : `docs/charge.md` (`npm run charge:vendredi`).
