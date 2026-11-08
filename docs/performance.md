# Performance (lot 8c, 8.11.2026)

## Ce qui a changé sans rien payer

| Changement | Effet |
|---|---|
| Accueil, carte et panier servis depuis le cache de Netlify (`revalidate = 60`) | La page ne passe plus par la fonction de l'Ohio quand Netlify l'a déjà. Le back-office, la tablette et la surveillance vident ce cache dès qu'un prix, une rupture, un horaire, une zone ou une pause change (`rafraichirCaches`). |
| Heure du serveur et adresses du client connecté par `/api/accueil` | Ce qui est propre au visiteur ne vit plus dans la page en cache. L'appel part après l'affichage et ne le retarde pas. |
| Une seule lecture de la carte, en cache | `/carte` relisait la vue `carte_publique` dans Supabase à chaque visite, sans cache. Elle partage maintenant la lecture en cache du catalogue. |
| Un seul client Supabase de lecture par fonction | Ses connexions restent ouvertes d'une requête à l'autre. |
| Logo à sa taille d'affichage | Fichier de 384 px (8 Ko) au lieu de 1920 px. |

Photos des plats : déjà passées par le service d'images de Netlify (WebP, taille adaptée à l'écran, chargées au fil du défilement). Rien à gagner sans retoucher les photos elles-mêmes.

Vérifié sur la préversion du lot : une rupture posée depuis la tablette apparaît sur la carte en cache en moins de 3 secondes. Elle disparaît aussi vite une fois levée.

## Temps mesurés le 8.11.2026

Premier octet (TTFB) en millisecondes, médiane de 9 mesures par page, sondes Globalping à Genève (Infomaniak) et Zurich, connexion neuve à chaque fois. Ancienne et nouvelle préversion mesurées au même moment. Détail brut et scripts dans `docs/rendus/lot-8c/`.

| Page | Avant | Après | Quand Netlify a la page tout près |
|---|---|---|---|
| Accueil `/` | 474 | 373 | 12 |
| Carte `/carte` | 874 | 446 | 14 |
| Panier `/panier` | 371 | 444 | pas observé |
| Commande `/commande` (reste à la demande) | 376 | 395 | sans objet |
| CGV `/cgv` (reste à la demande) | 355 | 366 | sans objet |

Lecture des chiffres :

- La carte est deux fois plus rapide, parce qu'elle ne lit plus la base à chaque visite.
- Les pages en cache arrivent en 12 à 14 ms quand le serveur Netlify le plus proche les a déjà. Sur une préversion presque sans visiteurs, c'est rare : la page vient alors du cache central de Netlify, en 270 à 450 ms. Avec de vrais clients, la part des réponses rapides augmentera. Ce gain ne se mesurera qu'en production.
- Le panier ne varie pas de façon significative (écarts de 145 à 930 ms selon la sonde dans les deux séries).

## Où part le temps aujourd'hui

Mesures du même jour :

| Trajet | Aller-retour réseau | Source |
|---|---|---|
| Ohio (région actuelle des fonctions, réseau Amazon à Columbus) vers Supabase Zurich | 101 ms | ping TCP Globalping vers `aws-0-eu-central-2.pooler.supabase.com` |
| Francfort vers Supabase Zurich | 7 ms | même mesure depuis Francfort (Oracle, xTom) |
| Genève vers Supabase Zurich | 6 ms | même mesure depuis Genève |
| Une lecture Supabase faite par la fonction de l'Ohio | 350 ms en médiane, 140 ms au mieux | `/api/diagnostic/latence` sur la préversion, région `us-east-2` |
| Une lecture du cache de données par la même fonction | 24 à 32 ms | même route |

Chaque page encore faite à la demande (commande, suivi, compte, tablette, back-office, paiement) traverse l'Atlantique au moins deux fois : du serveur Netlify européen à la fonction de l'Ohio, puis de la fonction à la base de Zurich, une fois par lecture ou écriture.

## Gain attendu avec Francfort (estimation, non mesurée)

Calcul fait à partir des allers-retours mesurés ci-dessus (101 ms depuis l'Ohio, 7 ms depuis Francfort). À vérifier avec `/api/diagnostic/latence` après le changement.

| Action | Aujourd'hui | Avec Francfort |
|---|---|---|
| Une lecture ou écriture en base faite par le serveur | environ 350 ms | environ 30 ms |
| Page à la demande sans base (CGV, commande d'un invité) | environ 360 ms | environ 100 ms de moins |
| Commande d'un client connecté (lecture de la session en plus) | environ 750 ms (395 mesurés pour un invité, plus une lecture) | environ 400 ms de moins |
| Bouton « Payer » (session, enregistrement de la commande, lien avec Stripe : deux à trois appels en série) | 0,8 à 1,2 s avant Stripe | 0,6 à 1 s de moins |
| Tablette : accepter, refuser, rupture (session du personnel puis une à deux écritures) | 0,7 à 1 s | 0,6 à 0,9 s de moins par geste |
| Accueil, carte, panier quand Netlify a la page | 12 à 14 ms | inchangé |

Le cache central de Netlify répond aujourd'hui en 270 à 450 ms depuis la Suisse. Je n'ai pas trouvé dans la documentation de Netlify s'il suit la région des fonctions (non vérifié).

## Prix de Netlify Pro (relevé le 8.11.2026)

Source : https://www.netlify.com/pricing/, page lue le 8.11.2026.

- Pro : 20 $ par mois pour l'équipe, membres illimités. Monnaie affichée « $ », facturation annuelle non indiquée sur la page.
- 3 000 crédits par mois inclus (Free : 300). Recharge Pro : 1 500 crédits pour 10 $.
- Consommation en crédits : 15 par mise en production, 10 par Go-heure de calcul, 20 par Go de bande passante, 2 pour 10 000 requêtes.

Le passage à Pro était déjà prévu pour le lancement (CLAUDE.md, décisions du 6.11.2026). Francfort ne coûte donc rien de plus que Pro. La seule question est de passer à Pro plus tôt.

Source pour la région : https://docs.netlify.com/functions/optional-configuration/, « available on all Pro and Enterprise plans ». Régions européennes en libre-service : Francfort (`fra`), Irlande (`dub`), Londres (`lhr`). Paris et Milan seulement par le support. Pas de Zurich.

## Changer la région (Jérémy, une fois sur Pro)

1. Sur app.netlify.com, ouvrir le projet boisterous-beijinho-c37e44.
2. Project configuration, puis Cloud compute, puis Functions, puis Region.
3. Configure, choisir Frankfurt (`fra`), puis Save.
4. Redéployer : Deploys, puis Trigger deploy, puis Deploy project. Les anciens déploiements gardent l'ancienne région.
5. Me prévenir : je relance `/api/diagnostic/latence` sur une préversion. Elle doit indiquer la région `eu-central-1` et des lectures autour de 30 ms.

Avec Next.js, la région se règle seulement dans l'interface, pour tout le projet (même page de documentation). Pas de modification du code.
