# La Ferme, site de commande (livraison et à emporter)

Restaurant La Ferme, Route de Chancy 132, 1213 Onex. Site neuf, sans lien avec `~/Desktop/Site_LaFerme` (n'y toucher jamais). Interlocuteur : Jérémy, fils du patron Giuseppe. Il juge sur un rendu, pas sur une spec. Prompt de référence : `docs/PROMPT.md` (gagne sur `docs/recherche/prompt-v1-ancien-site.md`).

## Méthode

- Par lots (`docs/PROMPT.md` §11). Une branche et une PR par lot, jamais de commit direct sur `main`.
- Avant chaque PR : `code-review`, plus `security-review` dès qu'il y a auth, paiement ou données clients.
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

Next.js (App Router, TypeScript) sur Vercel Pro, Supabase Zurich `eu-central-2` (Postgres, Auth, RLS sur toutes les tables, Realtime), Stripe, Resend, Star CloudPRNT puis Epson SDP derrière une interface commune, adresses par geo.admin.ch, Vitest et Playwright. Secrets en variables d'environnement seulement.

## Design

- Charger `ui-ux-pro-max` et `frontend-design` avant tout écran, puis la checklist `design-eviter-look-ia` (mémoire de Jérémy).
- Interdits : crème + Playfair + boutons pilule + cartes à ombre, rouge vif, dégradés, emoji, rangée de trois cartes à icône. Le bordeaux `#571A13` reste au logo.
- Photos : seulement le shooting pro de `~/Downloads/Plats`. Aucune image d'Uber Eats ni d'ailleurs.

## Textes et faits

- Tout texte client passe par `redaction-fr` avec le registre de faits `~/.claude/skills/redaction-fr/references/faits/la-ferme.md` et la fiche de voix `giuseppe-la-ferme.md`.
- Rien d'inventé : prix, provenance, allergène, délai, slogan. Pas de « fait maison » sans confirmation. Faits interdits : four napolitain, 450 °C, chêne, banquets, tram, tiramisù maison, mot du patron.
- Données client jamais dans une URL ni un outil d'analyse.
