# La Ferme, site de commande (livraison et à emporter)

Restaurant La Ferme, Route de Chancy 132, 1213 Onex. Site neuf, sans lien avec `~/Desktop/Site_LaFerme` (n'y toucher jamais). Interlocuteur : Jérémy, fils du patron Giuseppe. Il juge sur un rendu, pas sur une spec. Prompt de référence : `docs/PROMPT.md` (gagne sur `docs/recherche/prompt-v1-ancien-site.md`).

## Méthode

- Par lots (`docs/PROMPT.md` §11). Une branche et une PR par lot, jamais de commit direct sur `main`.
- Avant chaque PR : `code-review`, plus `security-review` dès qu'il y a auth, paiement ou données clients.
- Avant chaque fusion : vérifications GitHub vertes (`gh pr checks <numéro>`), lint, types, Vitest, build et Playwright. La protection de `main` n'existe pas sur le plan GitHub Free : c'est la règle qui la remplace (`docs/filet.md`).
- Après chaque lot : rendu bureau et mobile vérifié soi-même, puis montré.
- Pas de déploiement pendant un service (mardi à samedi, de 11h à 14h et de 18h30 à 23h). Aucune mise en production, vrai paiement ni e-mail à un vrai client sans accord écrit de Jérémy. Stripe en mode test.

## Décisions fixées (ne pas rediscuter)

- Mode (livraison ou retrait) puis adresse **avant** la carte. Contrôle de zone à l'adresse et de nouveau côté serveur au paiement.
- Commande possible en invité. Compte créé d'une case en fin de commande, connexion par code e-mail à 6 chiffres.
- Carte de base : `docs/recherche/carte-uber-brute.json`. Prix de la salle, validés un par un par Jérémy (`docs/validation-carte.xlsx`). Tant qu'un plat commandable a `prix_a_valider = true`, pas de mise en production.
- Aucun prix en dur dans le code ni les tests : la base de données est la seule source.
- Stripe (TWINT, cartes, Apple Pay et Google Pay). TWINT sans capture différée : encaissé au paiement, remboursé au refus.
- Tablette : une personne accepte chaque commande, l'acceptation imprime sur deux postes (pizza et cuisine), chacun ses lignes.
- Suppléments payants, retraits gratuits, imprimés en clair (`+`, `SANS`, `CHOIX`).
- Provenances affichées. Allergènes : « Allergènes : demandez-nous au 022 792 16 89 » tant que le restaurant ne les a pas fournis, et mise en ligne bloquée.

## Pile

Next.js (App Router, TypeScript) sur Netlify (choisi par Jérémy le 6.11.2026 à la place de Vercel), Supabase Zurich `eu-central-2` (Postgres, Auth, RLS sur toutes les tables, Realtime), Stripe, Resend, impression locale (voir Décisions après le prompt), adresses par geo.admin.ch, Vitest et Playwright. Secrets en variables d'environnement seulement.

## Décisions après le prompt

- **Hébergement : Netlify**, choisi par Jérémy le 6.11.2026 à la place de Vercel (il y a déjà son compte). Les mentions « Vercel » de `docs/PROMPT.md` (pile, déclaration de confidentialité, lot 2) se lisent « Netlify ». Plan gratuit pour les previews pendant la construction, Pro au lancement.
- **Impression, plan A (6.11.2026)** : imprimantes en câble sur le switch du restaurant. La tablette leur envoie les tickets directement par le réseau local à l'acceptation, sans passer par Internet. Elle vérifie en continu que chaque imprimante répond (papier, hors ligne) et propose « réimprimer ». Le serveur surveille la tablette : sans signe de vie, il met les commandes en ligne en pause et alerte la personne de service.
- **Impression, plan B** : si le navigateur bloque l'envoi vers une imprimante locale, l'imprimante va chercher ses tickets (Star CloudPRNT, de préférence en MQTT). À trancher au lot 7 avec l'imprimante en main, avant l'achat.
- La caisse du restaurant reste hors du système (confirmé par Jérémy le 6.11.2026).
- **Previews sur la base de production (6.11.2026)** : faute de projet Supabase de test, les previews ont la clé secrète du projet de production. Toute commande passée sur une preview est une commande de test dans la vraie base. Deux points bloquants avant mise en ligne, dans `docs/PROMPT.md` §11 (lot 8) : vider les commandes de test, retirer la clé secrète des previews.

## Commandes

- `npm run dev` : sans `.env.local`, la carte vient d'une base Postgres embarquée (PGlite) qui rejoue `supabase/migrations` et `supabase/seed.sql`.
- `BASE_LOCALE=1 npm run build` en local : accueil, carte et panier sont mis en cache dès le build et lisent la base embarquée (sans la variable, le build refuse).
- `npm test` (Vitest, base et sécurité par ligne), `npm run test:e2e` (Playwright sur un build de production local, Chrome du Mac). `PORT_E2E=<ton port réservé>` (liste dans `.claude/vague-2-regles.md`) : serveur, origine des tests et résultats (`test-results-<port>`) propres au port ; le build reste celui du worktree, un seul passage à la fois par worktree. Sans la variable : port 3200, à éviter quand d'autres sessions testent.
- `npm run seed:generer` : régénère `supabase/seed.sql` depuis `docs/carte-proposee.json`. Ne jamais modifier le seed à la main.
- `prebuild` (lancé par la commande de `netlify.toml`) lance `scripts/verifier-mise-en-ligne.ts` : sur Netlify en production, le build échoue tant que la vue `plats_bloquants` n'est pas vide.

## Design

- Direction **Béton** retenue par Jérémy le 5.11.2026 (référence : `maquette/a/`). La direction B est abandonnée.
- Charger `ui-ux-pro-max` et `frontend-design` avant tout écran, puis la checklist `design-eviter-look-ia` (mémoire de Jérémy).
- Interdits : crème + Playfair + boutons pilule + cartes à ombre, rouge vif, dégradés, emoji, rangée de trois cartes à icône. Le bordeaux `#571A13` reste au logo.
- Photos : seulement le shooting pro de `~/Downloads/Plats`. Aucune image d'Uber Eats ni d'ailleurs.

## Textes et faits

- Tout texte client passe par `redaction-fr` avec le registre de faits `~/.claude/skills/redaction-fr/references/faits/la-ferme.md` et la fiche de voix `giuseppe-la-ferme.md`.
- Rien d'inventé : prix, provenance, allergène, délai, slogan. Pas de « fait maison » sans confirmation. Faits interdits : four napolitain, 450 °C, chêne, banquets, tram, tiramisù maison, mot du patron.
- Données client jamais dans une URL ni un outil d'analyse.
