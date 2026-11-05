# Site de commande La Ferme : livraison et à emporter

Prompt de construction, version 2 du 5.11.2026. Il remplace la version 1 (`docs/recherche/prompt-v1-ancien-site.md`), écrite pour l'ancien site Eleventy que Jérémy a abandonné. La v1 reste une référence technique pour l'impression, le paiement, le légal et les tests. **Quand la v1 et ce fichier se contredisent, ce fichier gagne.**

## 1. Rôle et objectif

Tu construis de zéro le nouveau site du Restaurant La Ferme (Route de Chancy 132, 1213 Onex, Genève) dans `~/Desktop/LaFerme_Commande`. Ce site est entièrement pensé pour la **livraison et la vente à emporter**. Il doit être très beau, appétissant et rapide à utiliser, sur mobile d'abord, et solide côté backend. Il remplace Uber Eats, gardé en parallèle quelques mois. À 20 commandes par jour, Uber prélève environ 3 900 à 8 320 CHF par mois. Le système maison coûte quelques centaines de francs (`docs/recherche/comparatif-commande-en-ligne.md` §3).

Ton interlocuteur est Jérémy, fils du patron Giuseppe. Il juge sur un rendu, jamais sur une spec. Tu cadres en quelques lignes, tu construis par lots, tu montres. Il t'a demandé de « penser à tout » en UX, UI et fonctionnalités : tu proposes, il tranche.

## 2. Décisions de Jérémy (ne pas rediscuter)

| Sujet | Décision |
|---|---|
| Site | Nouveau, sans rapport avec `~/Desktop/Site_LaFerme` (essais abandonnés). Ne réutilise ni son design ni ses textes |
| Dépôt | Ce dossier + nouveau dépôt GitHub **privé** (compte `TheRemless`, `gh` est connecté). Branche par lot, PR, jamais de commit direct sur `main` |
| Parcours | Le client choisit **livraison ou retrait, puis son adresse, AVANT de voir les plats** (modèle Domino's Suisse, `benchmark-ux-fonctions.md`) |
| Comptes | Comptes clients obligatoirement proposés : adresses enregistrées, historique, recommander. Jamais de mur avant le paiement (Baymard : 18 % d'abandon si compte forcé) : commande possible en invité, compte créé d'une case en fin de commande, connexion par code e-mail |
| Carte | Base = carte Uber Eats relevée le 5.11.2026 (`docs/recherche/carte-uber-brute.json`, 80 articles : pizzas, entrées, pâtes, poissons, viandes, desserts, boissons, avec 29 suppléments pizza et le choix des pâtes) |
| Prix | **Prix de la salle**, pas les prix Uber. Voir §5 : le croisement automatique est à faire valider |
| Paiement | Stripe avec TWINT et cartes (Apple Pay et Google Pay si simples). Paiement sur place au retrait. Paiement à la livraison : option désactivée par défaut |
| Livraison | Livreurs salariés du restaurant. Zones, frais, minimum et horaires : propositions en §6, à valider, modifiables dans le back-office |
| Acceptation | Une personne accepte chaque commande sur une tablette. L'acceptation imprime automatiquement sur **deux imprimantes** (poste pizza et cuisine), chacune avec ses seules lignes |
| Heure | Choisie par le client ou fixée et modifiée par le restaurant, client notifié |
| À l'avance | Commande possible même quand c'est fermé. Elle arrive à la prochaine ouverture de la cuisine |
| Options | Ajouter des ingrédients (payant) ou en retirer (gratuit), surtout sur les pizzas, imprimés en clair |
| Provenances | Affichées (obligation légale en vente à distance). Jérémy a dit oui le 5.11.2026 |

## 3. Sources à lire avant de coder

Toutes dans `docs/recherche/` :

| Fichier | Ce que tu en tires |
|---|---|
| `benchmark-ux-fonctions.md` | Parcours de référence, bonnes pratiques sourcées, **liste des fonctions en trois niveaux**, pile technique recommandée, direction UI |
| `propositions-livraison-horaires.md` | Zones, frais, minimums, délais, horaires, coût d'un livreur |
| `carte-uber-brute.json` et `carte-croisee.json` | Carte et prix (voir §5) |
| `systeme_maison_tech.md`, `imprimantes_routage.md` | Stripe, CloudPRNT, Epson SDP, prix du matériel |
| `obligations_legales.md` | LCD, TVA, allergènes et provenances, nLPD, OIP, alcool, SCAV |
| `fonctions_precommande_paiement.md` | Ce que font les outils du marché (précommande, zones, paiement) |
| `prompt-v1-ancien-site.md` | Détails réutilisables : statuts de commande (§5), tablette (§7), impression et format du ticket (§8), paiement serveur et webhooks (§10), tableau légal (§11), sécurité (§12), tests (§14). Ignore tout ce qui concerne Eleventy, `carte.json`, Netlify Blobs et l'ancien design |

Mémoire de Jérémy à relire : `~/.claude/projects/-Users-admin-Desktop-Claude-Plugins/memory/commande-en-ligne-la-ferme.md`, `site-la-ferme.md` (faits sur le restaurant, photos, retours de goût) et `design-eviter-look-ia.md`. Registre de faits : `~/.claude/skills/redaction-fr/references/faits/la-ferme.md`. Fiche de voix : `~/.claude/skills/redaction-fr/references/voix/giuseppe-la-ferme.md`. Règles globales : `~/.claude/CLAUDE.md`.

## 4. Pile technique

Recommandation du benchmark, à confirmer en dix lignes au début du lot 1 si tu vois mieux :

- **Next.js** (App Router, TypeScript) hébergé sur **Vercel Pro** (le plan Hobby est non commercial).
- **Supabase** en région Zurich `eu-central-2`, plan Pro (pas de mise en pause) : Postgres, Auth (code e-mail à usage unique), Row Level Security sur toutes les tables, Realtime pour la tablette et le suivi.
- **Stripe** Checkout ou Payment Element avec TWINT. TWINT n'accepte pas la capture différée : on encaisse au paiement et on rembourse en cas de refus, frais Stripe perdus. D'où l'importance d'éviter les refus avant paiement : zone vérifiée, plats en rupture, pause, capacité par créneau.
- **Resend** pour les e-mails. SMS (Twilio ou ASPSMS) prêt mais désactivé.
- **Impression** : Star CloudPRNT (mC-Print3 Ethernet) en premier, Epson Server Direct Print en second, derrière une interface commune. File d'impression en base.
- **Adresses** : autocomplétion par l'API fédérale geo.admin.ch, puis contrôle de zone **côté serveur**.
- Tests : Vitest pour la logique, Playwright pour les parcours. Secrets uniquement en variables d'environnement.

Coût estimé : 45 à 65 USD par mois plus les frais Stripe (`benchmark-ux-fonctions.md` §4).

## 5. La carte et les prix

`carte-croisee.json` associe automatiquement chaque article Uber à un plat de la carte de la salle (`~/Desktop/Site_LaFerme/src/_data/carte.json`, relevée sur l'ancien site Wix). Champs `prixUber`, `prixSalle`, `salleNom`, `score`.

Ce qu'il faut savoir :
- 64 articles ont un prix de salle, 16 n'en ont pas : les 4 boissons, les 3 desserts, le cheeseburger, la burrata, la salade de chèvre chaud, la terrine de foie gras, les pâtes aux crevettes, les gnocchi alla romana et au gorgonzola, la pasta aglio, le risotto Saint-Jacques.
- Correspondances fausses ou douteuses à corriger : « Pizza Romana » a été associée à des gnocchi (faux), « Gnocchi pommes de terre », « Lasagne de bœuf », « Linguine au saumon fumé » et toute ligne avec un score inférieur à 0,9.
- **Les prix de salle ne sont pas toujours plus bas que ceux d'Uber** : Peppino 28 contre 27, salade paysanne 32 contre 29, tartare de bœuf 34 contre 32, mari e monti 32 contre 30, poissons 34 à 38 contre 33 à 38. La carte de la salle est peut-être plus récente ou fausse. Ne tranche pas.

Ce que tu fais :
1. Au lot 1, produis avec le skill `xlsx` un tableau de validation pour Jérémy : catégorie, nom, description, prix Uber, prix salle proposé, écart, colonne « prix validé », colonne « commandable », colonne « station » (pizza ou cuisine), colonne « provenance », colonne « allergènes ». Pré-remplis prix salle quand il existe, sinon vide.
2. En attendant sa réponse, la base est amorcée avec le prix de salle quand il existe, sinon le prix Uber, avec un drapeau `prix_a_valider = true`. Le back-office affiche ces drapeaux. **La mise en production est bloquée tant qu'un plat commandable a un prix non validé.**
3. Les suppléments pizza reprennent les prix Uber (seule source), drapeau à valider aussi. Les retraits d'ingrédients sont générés depuis la description, gratuits, et validés par Jérémy.
4. Le tiramisu et la terrine sont annoncés « fait maison » sur Uber. Le registre de faits classe « tiramisù maison » parmi les faits inventés par le passé. N'écris « fait maison » nulle part tant que Jérémy ne l'a pas confirmé.
5. Provenances : celles de la carte de la salle (bœuf et porc CH/A, canard FR, agneau NZ, bar France, vongole Italie, perches Estonie, saumon Norvège, gambas Vietnam, loup de mer Espagne) sont reprises avec la mention de leur source. Il manque au moins le poulet, le thon, le jambon, les charcuteries, le homard, les fruits de mer, les calamars, les Saint-Jacques : colonne à remplir dans le tableau. Allergènes : à fournir par le restaurant. En attendant, la fiche plat affiche « Allergènes : demandez-nous au 022 792 16 89 » et la mise en ligne reste bloquée.
6. Photos : utilise le shooting pro de `~/Downloads/Plats` (21 fichiers, droits acquis). Ne télécharge **aucune** photo d'Uber Eats ni d'ailleurs. Les plats sans photo ont un traitement graphique soigné, pas une image générique.
7. Le prix d'un plat ne se modifie que dans le back-office (base de données). Aucun prix en dur dans le code ou les tests.

## 6. Livraison et horaires (propositions à valider)

Détail et sources dans `propositions-livraison-horaires.md`. Valeurs par défaut en base, modifiables dans le back-office, affichées à Jérémy comme « proposition » au lot 3 :

| Zone | Communes et NPA | Frais | Minimum | Délai annoncé |
|---|---|---|---|---|
| 1 (jusqu'à 2,6 km) | Onex 1213, Petit-Lancy 1213, Grand-Lancy 1212, Confignon 1232, Bernex 1233 | 2.90 CHF | 30 CHF | 30 à 40 min |
| 2 (3,9 à 5,5 km) | Jonction et Plainpalais 1205, Carouge 1227, Plan-les-Ouates 1228, Le Lignon 1219 | 4.90 CHF | 40 CHF | 40 à 50 min |
| 3 (5,5 à 7 km) | Servette, Pâquis, Eaux-Vives, Champel, Vernier, Perly, Cartigny | 7.90 CHF | 60 CHF | désactivée au lancement |

Horaires proposés (les horaires Uber actuels sont du mardi au samedi, de 11h30 à 13h45 et de 18h30 à 21h45, pizzas jusqu'à 22h45) :
- Midi : livraison et retrait de 11h45 à 13h45, dernière commande 13h15.
- Soir : de 18h45 à 22h45, dernière commande 21h30 pour la carte complète, 22h15 pour les pizzas.
- Fermé dimanche et lundi. Commandes à l'avance jusqu'à 7 jours, ouvertes le dimanche et le lundi pour le mardi.
- Préparation 20 min par défaut (réglable en direct depuis la tablette), créneaux de 15 min, capacité par créneau réglable.
- Fermeture annuelle du 22.12.2026 au 11.01.2027 inclus, réouverture le mardi 12.01.2027.

Hors zone : message clair, proposition du retrait. Le contrôle de zone se fait au choix de l'adresse, avant la carte, et de nouveau côté serveur au paiement.

## 7. Fonctionnalités

Reprends la liste priorisée de `benchmark-ux-fonctions.md` §3. Minimum attendu au lancement :

**Client**
- Accueil : choix livraison ou retrait, adresse avec autocomplétion (étage, sonnette, code d'entrée, instructions), contrôle de zone immédiat avec frais, minimum et délai affichés. Adresses enregistrées pour un client connecté.
- Créneau : « dès que possible » ou plus tard, y compris restaurant fermé.
- Carte : catégories collantes, recherche, plats populaires en tête, fiches avec photo, description, options, provenance et allergènes. Plats en rupture grisés avec la raison.
- Options : choix obligatoires (pâtes), suppléments payants (max 5 comme sur Uber, à valider), retraits gratuits, note courte.
- Panier persistant, visible en permanence, montant manquant pour le minimum, frais clairs avant paiement.
- Checkout en une page : coordonnées, récapitulatif modifiable (LCD), paiement Stripe, case « créer mon compte ».
- Confirmation immédiate par e-mail, page de suivi en direct (reçue, acceptée avec heure, en préparation, partie ou prête, livrée), e-mail à chaque changement d'heure ou au refus avec remboursement.
- Compte : connexion par code e-mail, adresses, historique, « recommander la même chose », données exportables et suppression du compte (nLPD).
- Code promo simple (flyers avec QR vers le site), désactivé tant que Jérémy n'a pas fixé d'offre.
- PWA installable. Français au lancement, structure prête pour l'anglais et l'italien.

**Restaurant (tablette et back-office)**
- Tablette : file des commandes avec alerte sonore, accepter (heure ajustable par boutons), refuser avec remboursement, statuts, réimpression, pause des commandes avec reprise automatique, rupture d'un plat, délai de préparation du moment, commandes à l'avance, état des imprimantes.
- Back-office : carte (prix, descriptions, photos, disponibilité, options, station, provenance, allergènes, drapeau de validation), zones et horaires, fermetures, codes promo, clients, remboursements, statistiques simples, export CSV comptable par taux de TVA.
- Livreurs (niveau 2 si trop lourd au lancement) : assignation, ordre de tournée, lien de navigation, statut « partie » depuis le téléphone du livreur.

Ce qui vient plus tard (fidélité, web push, avis, SMS, multilingue) : prépare le terrain, ne le construis pas sans accord.

## 8. Design

Le site doit être beau. C'est la première chose que Jérémy jugera.

- Charge `ui-ux-pro-max` et `frontend-design` ensemble avant tout écran, puis applique la checklist de `design-eviter-look-ia.md`.
- Retours de goût déjà connus de Jérémy (mémoire `site-la-ferme`) : il a jugé « site IA bas de gamme » le crème + Playfair + boutons pilule + cartes à ombre. Il veut épuré, agréable pour les yeux, facile à naviguer, qui donne envie, des textes qui ne font pas robotiques. Le logo est bordeaux foncé `#571A13` : **aucun rouge vif dans l'interface**. Pas de dégradé, pas d'emoji, pas de rangée de trois cartes à icône.
- Les photos du shooting pro portent le site. La carte doit donner faim.
- **Lot 1 commence par une maquette** : accueil (choix du mode et adresse), carte, fiche plat avec options, panier, checkout, suivi, tablette. Bureau et mobile. Rendu réel vérifié par toi avant de le montrer. Présente 2 directions visuelles franches au maximum, pas plus. Aucun texte définitif ni code de production avant que Jérémy ait choisi.

## 9. Textes

Tout texte visible par un client passe par `redaction-fr`, avec le registre de faits et la fiche de voix de Giuseppe. Rien d'inventé : pas de slogan, pas de promesse de délai non validée, pas de « fait maison » non confirmé, aucun des faits interdits du registre (four napolitain, 450 °C, chêne, banquets, tram, tiramisù maison, mot du patron). Les nouveaux faits (livraison par les livreurs du restaurant, zones, horaires) sont ajoutés au registre avec leur date une fois validés par Jérémy.

## 10. Légal

Reprends le tableau §11 de la v1 et `obligations_legales.md` : identification et étapes de commande (LCD), confirmation immédiate, TVA 2,6 % emporter et livraison contre 8,1 % pour l'alcool et sur place, mentions du reçu, provenances et allergènes avant l'achat, prix en CHF, déclaration de confidentialité (Supabase, Vercel, Stripe, Resend), suppression de compte, alcool désactivé (autorisation à part à Genève, interdit de 21h à 7h), annonce au SCAV. Stripe exige pour TWINT un site public avec mentions légales, CGV, contact et prix en CHF. Tu prépares des ébauches marquées « à faire relire », tu ne publies aucune page légale non validée. Raison sociale, forme juridique, numéro IDE TVA : à demander.

## 11. Lots

Une branche et une PR par lot. Avant chaque PR : `code-review`, puis `security-review` dès qu'il y a auth, paiement ou données clients. Après chaque lot : rendu bureau et mobile vérifié, puis montré. Paiements en mode test jusqu'à l'accord écrit de Jérémy. Aucune mise en production sans lui. Jamais de déploiement pendant un service (du mardi au samedi, de 11h à 14h et de 18h30 à 23h).

| Lot | Contenu | Ce que tu montres |
|---|---|---|
| 1 | Dépôt GitHub privé, `CLAUDE.md` du projet, maquette (2 directions max) bureau et mobile, tableau xlsx de validation de la carte | Maquettes et tableau |
| 2 | Socle : Next.js, Supabase (schéma, RLS, migrations, amorçage de la carte), Vercel preview | Carte réelle affichée dans la direction choisie |
| 3 | Mode, adresse, zones, créneaux, horaires, fermetures | Parcours d'entrée, cas hors zone, cas fermé |
| 4 | Fiche plat, options, panier, calcul serveur des prix (frais, minimum, TVA) | Panier mobile avec options |
| 5 | Checkout, Stripe test (TWINT et carte), webhooks, e-mails, suivi | Paiement test de bout en bout |
| 6 | Comptes, adresses enregistrées, historique, recommander, export et suppression | Espace client |
| 7 | Tablette, back-office, impression CloudPRNT avec une vraie imprimante | Acceptation et deux tickets imprimés |
| 8 | Légal, accessibilité, performances, recette en service fictif, mise en ligne sur accord | Liste de contrôle cochée |

## 12. Ce que Jérémy doit fournir (demande-le au lot qui en a besoin)

Validation des prix et des plats commandables (tableau xlsx), stations pizza ou cuisine, prix des suppléments, provenances manquantes, allergènes, validation des zones, frais et horaires proposés, fait maison ou non, raison sociale et numéro TVA, achat des imprimantes et de la tablette, compte Stripe et activation TWINT, nom de domaine (restaurantlaferme.ch est encore sur Wix, ce site est-il le site principal ou un sous-domaine ?), offre de lancement pour les flyers.

## 13. Interdits

Inventer un prix, un fait, une provenance, un allergène, un délai ou un texte marketing. Réutiliser des photos ou textes d'Uber Eats autres que les noms et descriptions de plats du restaurant. Rouge vif ou look « template IA ». Données client dans une URL ou un outil d'analyse. Clés de production dans le dépôt ou la conversation. Mise en production, vrai paiement, e-mail à un vrai client sans accord écrit. Toucher à `~/Desktop/Site_LaFerme` ou à la caisse du restaurant.
