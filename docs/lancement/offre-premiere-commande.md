# Offre de première commande : trois options

Document interne, pas un texte public. Le choix revient à Jérémy. Aucune option n'est retenue ici.

## Base de calcul

| Donnée | Valeur | Source |
|---|---|---|
| Panier de référence | CHF 50 | Panier moyen annoncé par Jérémy le 3.11.2026 |
| Frais Stripe | TWINT 1,9 % + CHF 0.30, carte 2,9 % + CHF 0.30 | `docs/recherche/comparatif-commande-en-ligne.md` [22], relevé le 3.11.2026, non revérifié |
| Frais de livraison proposés | CHF 2.90 en zone 1, CHF 4.90 en zone 2 | Proposition du 5.11.2026, non validée |
| Coût réel d'une livraison pour le restaurant | de CHF 11 à 16 nets (estimation) | `docs/recherche/propositions-livraison-horaires.md` §3 |
| Commission Uber Eats sur CHF 50 | CHF 7.50 (formule à 15 %) ou CHF 16 (formule à 32 %) | Grille officielle Uber Eats Suisse, relevée le 3.11.2026 |

« Coût par commande » veut dire ici le montant que le restaurant n'encaisse pas, au prix de vente. Le coût des ingrédients n'est pas connu (à demander à Giuseppe).

La formule Uber Eats actuelle de La Ferme (15 % ou 32 %) n'est pas connue. Elle se lit dans Uber Eats Manager, rubrique facturation. Elle change la lecture du tableau : une commande ramenée d'Uber économise sa commission à chaque commande suivante, l'offre ne se paie qu'une fois.

## Les trois options

| | A. 10 % sur la première commande | B. Livraison offerte sur la première commande | C. CHF 10 de moins dès CHF 40 |
|---|---|---|---|
| Ce que voit le client | 10 % de moins sur le total des plats | Frais de livraison à zéro | CHF 10 de moins |
| Coût à CHF 50 | CHF 5.00 (environ 4.90 après la baisse des frais Stripe) | CHF 2.90 en zone 1, CHF 4.90 en zone 2, rien au retrait | CHF 10.00 (environ 9.80 après Stripe) |
| Part du panier | 10 % | de 6 à 10 % | 20 % |
| Comparé à une commission Uber à 15 % (CHF 7.50) | Moins cher, une seule fois | Moins cher, une seule fois | Plus cher la première fois, rattrapé dès la deuxième commande passée sur le site au lieu d'Uber |
| Effet attendu | Argument simple à imprimer, vaut pour la livraison et le retrait | Vise exactement le client Uber, qui a l'habitude de payer la livraison | L'offre la plus visible des trois sur un flyer |
| Effet mesuré ailleurs | Non vérifié. Les éditeurs de logiciels de commande conseillent de 10 à 15 % sur la première commande directe (source intéressée, sans méthode publiée) | Non vérifié | Non vérifié |
| Risque d'abus | Moyen : une nouvelle adresse e-mail suffit pour recommencer | Faible : le gain est petit et ne vaut qu'en livraison | Élevé : CHF 10 justifient de créer des adresses e-mail jetables |
| Effet de bord | Aucun | Pousse vers la livraison, qui coûte de CHF 11 à 16 au restaurant, plutôt que vers le retrait, qui ne coûte rien | Un minimum de CHF 40 est au-dessus du minimum proposé en zone 1 (CHF 30) |

Aucune étude indépendante ne compare ces formules. Aucune donnée en francs suisses n'a été trouvée (recherche du 12.11.2026). Un seul chiffre circule sur la carte glissée dans le sac : de 8 à 12 % des clients de plateforme passeraient en direct (Chowly, 8.6.2026, éditeur de logiciel, non vérifié). Le code par support permettra de mesurer le vrai taux de La Ferme.

## Garde-fous communs, quelle que soit l'option

- Une seule utilisation par e-mail, par numéro de téléphone et par adresse de livraison, vérifiée côté serveur.
- Valable sur une période fixée (par exemple les huit semaines de la campagne de flyers), puis désactivé.
- Un code différent par support (flyer, autocollant, fiche Google) pour savoir lequel ramène des commandes.
- Aucune comparaison de prix avec Uber Eats dans un texte public sans l'accord de Jérémy.

## Code promo : ce qui existe dans le code

Rien. Aucune table, aucun champ ni écran de code promo dans `src/` ni `supabase/migrations/` (recherche du 12.11.2026 sur `origin/main` 0193788 : « promo », « coupon », « remise », « réduction »). `docs/PROMPT.md` §7 le prévoyait, désactivé tant que Jérémy n'a pas fixé d'offre.

### Besoin, pour une autre session (ne pas le coder ici)

1. Table `codes_promo` : code, type (pourcentage, montant fixe, livraison offerte), valeur, minimum de commande, dates de début et de fin, nombre maximal d'utilisations, première commande seulement, actif. RLS : lecture par le serveur seulement.
2. Saisie du code au panier. Pré-remplissage par `?code=` dans l'adresse du QR (le code est gardé dans le navigateur, jamais une donnée du client dans l'URL).
3. Calcul de la remise côté serveur dans le calcul du panier (`src/lib/panier.ts`), revérifié au paiement comme la zone. Aucun montant en dur.
4. « Première commande » contrôlée sur l'e-mail normalisé, le téléphone et l'adresse de livraison, commandes payées seulement.
5. Commande : code et montant de la remise enregistrés. Montant Stripe après remise. Remboursement partiel ou total cohérent avec la remise.
6. Ticket de cuisine inchangé. Reçu, e-mail de confirmation et suivi : ligne « Remise » avec le montant.
7. TVA : la remise réduit la base imposable (2,6 %). À faire confirmer par la fiduciaire pour l'export comptable.
8. Back-office : créer, désactiver, voir le nombre d'utilisations et le chiffre d'affaires par code. Journal de gestion.
9. Tests Vitest (calcul, abus, dates, minimum) et Playwright (panier avec code, code refusé). Aucun prix en dur dans les tests.
10. `security-review` obligatoire (paiement), capture avant et après, fusion seulement après l'avis de Jérémy (changement visible par le client).
