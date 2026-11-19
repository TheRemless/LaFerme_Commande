# Stripe pas à pas

Guide pour brancher le paiement en ligne, écrit le 19.11.2026 à partir du code de `main` (bb8d8e5f) et de la documentation officielle de Stripe lue le même jour (aucune date de mise à jour n'y est affichée). Jérémy saisit tout lui-même dans Stripe et dans Netlify. Aucune clé ni aucun secret ne s'écrit dans ce document, dans une conversation ou dans un fichier du dépôt.

Ordre :
1. Ouvrir et activer le compte.
2. Activer les moyens de paiement.
3. Préparer une base de test (sans elle, aucun paiement de test ne passe sur une préversion).
4. Brancher le mode test dans Netlify et le webhook de test.
5. Paiement de test de bout en bout, rejoué par Claude.
6. Bascule en live, le jour de la mise en ligne.

## 1. Ouvrir et activer le compte

Sur dashboard.stripe.com, créer le compte au nom de la Sàrl, pays Suisse. La vérification se fait ensuite à l'adresse dashboard.stripe.com/account/onboarding. La page officielle (docs.stripe.com/get-started/account/activate) dit seulement que Stripe demande des informations sur l'entreprise, son activité et le lien de la personne avec l'entreprise. Il peut en demander d'autres plus tard. Elle ne donne pas la liste des écrans : suivre ceux qu'affiche Stripe.

À avoir sous la main, parce que le formulaire les demandera vraisemblablement :
- la raison sociale, la forme juridique (Sàrl) et le numéro IDE CHE-103.250.692 ;
- l'adresse du restaurant, Route de Chancy 132, 1213 Onex ;
- l'identité de la personne qui représente la société ;
- l'IBAN du compte du restaurant qui recevra les versements.

À régler aussi dans le compte (Paramètres, informations publiques) : le nom affiché, l'e-mail et le téléphone de contact. Régler aussi le libellé qui paraît sur le relevé du client. Une fois un service Stripe activé en live, le pays de l'entreprise ne se change plus.

## 2. Moyens de paiement

Le code ne fixe aucun moyen de paiement : la page de paiement de Stripe (Checkout, en francs suisses, en français) propose ceux qui sont activés dans dashboard.stripe.com/settings/payment_methods (`src/lib/paiement/passerelle.ts`, `creerSession`). Le site annonce « TWINT ou carte bancaire » au paiement et dans sa description.

| Moyen | À faire | Ce que dit Stripe |
|---|---|---|
| TWINT | L'activer dans les réglages des moyens de paiement | Clients en Suisse, en CHF, de CHF 0.50 à 5 000 par paiement. Confirmation immédiate. Remboursements possibles pendant 180 jours, en général en quelques minutes ; un remboursement échoué revient sur le solde Stripe et se rend autrement. Stripe vérifie le site avant d'ouvrir TWINT : site accessible au public, prix en CHF, raison sociale, forme juridique, adresse, conditions générales, e-mail ou téléphone de contact (docs.stripe.com/payments/twint). Tant que le site n'est pas en ligne, TWINT peut rester « en attente » en live. |
| Cartes | Actives par défaut | Rien à faire de plus. |
| Apple Pay | Rien : sur la page de paiement hébergée par Stripe, il marche sans réglage (docs.stripe.com/apple-pay) | Affiché seulement sur un appareil Apple compatible. Le site ne l'annonce pas : à ajouter au texte seulement une fois constaté au paiement de test. |
| Google Pay | L'activer dans les mêmes réglages (docs.stripe.com/google-pay) | La page Stripe parle d'enregistrer le domaine pour Google Pay sans dire si la page hébergée en dispense. Le site ne l'annonce pas : à constater au paiement de test. |

Aucun autre moyen n'est prévu. La commande se règle en une fois, sans pourboire ni paiement fractionné.

## 3. Une base de test d'abord

Une préversion refuse tout paiement, même de test, tant qu'elle écrit dans la vraie base : la carte de test y créerait une commande « payée » sur la vraie tablette (`clientStripe` dans `src/lib/paiement/passerelle.ts`, audit de sécurité S2). Elle n'accepte une clé Stripe de test que si elle est branchée sur un projet Supabase de test (`BASE_DE_TEST=1`, `src/lib/environnement.ts`). Ce projet n'existe pas encore (phase 3 de [mise-en-ligne.md](mise-en-ligne.md)).

Ce qui manque et qui le fait :

| Étape | Qui |
|---|---|
| Créer un projet Supabase de test, région Zurich. Le plan Pro le permet ; sur le plan gratuit, à vérifier dans Supabase | Jérémy (création de compte et de projet) |
| Y appliquer les migrations et l'amorçage : depuis le dossier du projet, `npx supabase link --project-ref <ref du projet de test>` puis `npx supabase db push --include-seed`. Vérifier d'abord l'option avec `npx supabase db push --help`. Puis relier de nouveau le projet de production (`npx supabase link --project-ref <ref de production>`) pour que les poussées suivantes partent au bon endroit | Jérémy (Claude n'écrit jamais sur une base distante) |
| Se créer l'accès gérant dans le projet de test, comme en production : SQL Editor, `insert into personnel (email, nom, role) values ('<son adresse en minuscules>', 'Jérémy', 'gerant');` | Jérémy |
| Dans Netlify, contextes « Deploy Previews » et « Branch deploys » : remplacer `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` par celles du projet de test, puis poser `BASE_DE_TEST` = `1` | Jérémy |
| Vérifier qu'une préversion neuve lit bien le projet de test (carte d'amorçage, aucune commande réelle) | Claude |

`BASE_DE_TEST` ne se pose jamais en production : le build de production échoue s'il la trouve.

## 4. Mode test : clés et webhook

Dans Stripe, rester en mode test (bascule en haut du tableau de bord).

### Clé de test

Sur dashboard.stripe.com/apikeys, en mode test :
- soit la clé secrète de test (elle commence par `sk_test_`) ;
- soit, comme Stripe le recommande, une clé limitée (`rk_test_`) avec deux droits en écriture : « Checkout Sessions » et « Refunds ». Le code n'utilise rien d'autre (création, lecture et expiration des sessions ; création et liste des remboursements). Si un droit manque, le paiement de test du point 5 le montrera.

Le code refuse une clé de production hors production. Il refuse aussi toute clé sur une préversion branchée sur la vraie base.

### Webhook de test

Le webhook est la seule source qui confirme un paiement, avec la relecture de la session au retour du client sur la page de suivi (`reconcilier`). Sans lui, les expirations, les échecs TWINT et l'état des remboursements n'arrivent pas.

Dans Stripe, en mode test : Workbench, onglet Webhooks (dashboard.stripe.com/webhooks), « Create an event destination », puis :
1. « Your account ».
2. Format des données : Snapshot, pas Thin. Le code lit l'objet complet joint à l'événement (`evenement.data.object` dans `src/app/api/stripe/webhook/route.ts`) ; un événement « Thin » ne le contient pas.
3. Version de l'API : `2026-10-28.endive`, celle de la bibliothèque Stripe du site (`stripe` 23.1.0).
4. Événements à cocher, exactement ces cinq :

| Événement | Ce que le site en fait |
|---|---|
| `checkout.session.completed` | Paiement confirmé (carte ou TWINT déjà payé) : la commande arrive sur la tablette, e-mail au client. Sert aussi au complément d'une commande modifiée et au filet des paiements qui ne confirment pas leur commande (#258) |
| `checkout.session.async_payment_succeeded` | Paiement confirmé plus tard. Même traitement |
| `checkout.session.async_payment_failed` | Paiement échoué : la commande est annulée si la session est encore la sienne |
| `checkout.session.expired` | Session expirée après 30 minutes, ou fermée par le site au retour arrière : même règle |
| `charge.refund.updated` | État d'un remboursement (fait, en attente, échoué). Un échec alerte le restaurant |

Le code accepte aussi `refund.updated`, qui porte la même information : ne pas le cocher en plus, un seul suffit. Les compléments par lien, les deux onglets et les paiements remboursés par le filet passent par les quatre événements `checkout.session.*` : rien de plus à cocher. La cagnotte ne passe pas par Stripe.

5. Destination : « Webhook endpoint », adresse `https://<adresse de la préversion>/api/stripe/webhook`. Une préversion porte l'adresse `deploy-preview-<numéro de PR>--boisterous-beijinho-c37e44.netlify.app`. Pour la recette, Claude indique la préversion à utiliser ; à chaque nouvelle préversion, modifier l'adresse de cette même destination plutôt que d'en créer une autre.
6. Ouvrir la destination créée, « Reveal secret » : le secret commence par `whsec_`.

### Variables Netlify

Projet boisterous-beijinho-c37e44, Project configuration, Environment variables. Pour chaque variable, choisir les contextes.

| Variable | Deploy Previews et Branch deploys | Production |
|---|---|---|
| `STRIPE_SECRET_KEY` | la clé de test | rien avant la bascule |
| `STRIPE_WEBHOOK_SECRET` | le secret du webhook de test | rien avant la bascule |
| `BASE_DE_TEST` | `1`, avec les clés du projet Supabase de test (point 3) | jamais |

Ensuite, redéployer la préversion (Deploys, Trigger deploy) pour qu'elle lise les variables. Puis prévenir Claude.

## 5. Paiement de test de bout en bout

Claude le rejoue sur la préversion branchée sur le projet de test, hors des heures de service, puis vérifie pour chaque essai la base de test, la tablette, les tickets, les e-mails et, dans Stripe, l'événement reçu par le webhook (réponse 200). Cartes de test officielles (docs.stripe.com/testing) : n'importe quelle date future (par exemple 12/34) avec n'importe quel code à trois chiffres.

| Essai | Comment | Attendu |
|---|---|---|
| Carte acceptée | 4242 4242 4242 4242 | Commande « nouvelle » sur la tablette, e-mail de confirmation, `checkout.session.completed` reçu |
| Carte refusée | 4000 0000 0000 0002 | Refus sur la page de Stripe, commande toujours en attente de paiement. Après 30 minutes, `checkout.session.expired` l'annule |
| Authentification 3-D Secure | 4000 0027 6000 3184 | Fenêtre d'authentification de test, puis paiement confirmé |
| TWINT | Choisir TWINT sur la page de paiement | La documentation lue ne décrit pas TWINT en mode test : Claude note ce que la page de test propose (accepter, refuser) et le résultat |
| Remboursement | Refuser sur la tablette la commande payée par la 4242 | Remboursée, e-mail au client, `charge.refund.updated` reçu |
| Remboursement en attente | Payer avec 4000 0000 0000 7726, puis refuser | « En cours », puis fait quelques minutes plus tard |
| Remboursement qui échoue | Payer avec 4000 0000 0000 5126, puis refuser | Accepté, puis échoué quelques minutes plus tard : alerte au restaurant, absent de l'export |
| Complément | Modifier au back-office une commande payée pour un montant plus élevé, puis payer le lien avec la 4242 | Complément confirmé sur la commande |
| Retour arrière | Ouvrir le paiement, revenir au site, repayer | Une seule commande, confirmée par la nouvelle session ; l'ancienne fermée sans annuler la commande |
| Deux onglets | Ouvrir le paiement dans deux onglets, payer l'ancien, puis le second | Le premier paiement confirme la commande ; le second est remboursé, avec alerte et e-mail « second paiement » |
| Apple Pay, Google Pay | Ouvrir le paiement sur un iPhone et sur un Android | Noter s'ils paraissent. Stripe : Apple Pay en mode test demande une vraie carte dans le Wallet, débitée de rien |

Les écarts vont dans une PR avant la bascule.

## 6. Bascule en live

Le jour de la mise en ligne, sans service, avec l'accord écrit de Jérémy (phase 4 de [mise-en-ligne.md](mise-en-ligne.md)) :
1. Compte activé en live, TWINT activé en live (il demande le site accessible au public).
2. Clé live dans Netlify, contexte Production seulement : `STRIPE_SECRET_KEY` (`sk_live_` ou une clé limitée `rk_live_` avec les mêmes deux droits). En live, une clé créée par soi ne s'affiche qu'une fois : la coller tout de suite dans Netlify.
3. Webhook live : mêmes réglages qu'au point 4 (Snapshot, version `2026-10-28.endive`, les cinq événements), adresse `https://<domaine>/api/stripe/webhook`. Son secret dans `STRIPE_WEBHOOK_SECRET`, contexte Production.
4. Déploiement de production par le build Netlify.
5. Premier vrai paiement de faible montant par TWINT, refusé sur la tablette : le remboursement doit arriver. Claude vérifie Stripe, la base, les tickets et les e-mails.
