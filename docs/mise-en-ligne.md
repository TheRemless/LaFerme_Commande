# Mise en ligne

Liste de contrôle du site de commande, à suivre dans l'ordre. Rien ne part en production sans l'accord écrit de Jérémy. Pas de déploiement pendant un service (du mardi au samedi, de 11h à 14h et de 18h30 à 23h).

## Résumé pour Jérémy

1. Remplir le tableau `docs/validation-carte.xlsx` : prix, plats commandables, poste pizza ou cuisine, provenances, allergènes, suppléments. Dire si le tiramisù et la terrine sont faits maison.
2. Valider dans le back-office les zones, frais, minimums, délais, horaires et fermetures.
3. Donner la raison sociale, la forme juridique, le numéro IDE, le numéro TVA et l'e-mail du restaurant. Demander à la fiduciaire la durée de conservation des commandes.
4. Faire relire les trois pages légales par un professionnel.
5. Annoncer la livraison au SCAV.
6. Choisir le nom de domaine et donner l'accès à ses réglages DNS.
7. Ouvrir Stripe (TWINT), créer l'adresse d'envoi chez Infomaniak, Supabase Pro et Netlify Pro, puis régler Netlify sur Francfort.
8. Acheter une imprimante, la brancher, puis la deuxième une fois la première testée. Prévoir la tablette.
9. Faire la recette en service fictif avec l'équipe.
10. Donner l'accord écrit pour la bascule, puis faire le premier vrai paiement, remboursé.
11. Poser les réglages de la sauvegarde dans GitHub, puis créer le moniteur UptimeRobot au lancement ([filet.md](filet.md)).

Les clés et mots de passe (Stripe, Infomaniak, Supabase) se saisissent directement dans Netlify. Jamais dans une conversation.

## Phase 1 : ce que Jérémy fournit ou crée

### Carte

- [ ] Jérémy : remplir les cases jaunes de `docs/validation-carte.xlsx` (prix validé, commandable, poste, provenance, allergènes), puis l'importer dans le back-office, rubrique « Importer le tableau ». Détail : [back-office.md](back-office.md).
- [ ] Jérémy : valider le prix de chaque supplément et choix de pâtes. Valider aussi les retraits gratuits de chaque plat. Détail : [back-office.md](back-office.md).
- [ ] Jérémy : dire si le tiramisù et la terrine sont « fait maison ». Sans réponse, la mention n'apparaît nulle part. Détail : [PROMPT.md](PROMPT.md) §5.
- [ ] Jérémy : fournir les allergènes de chaque plat. Tant qu'ils manquent, le site affiche « Allergènes : demandez-nous au 022 792 16 89 » et la mise en production reste bloquée. Détail : [PROMPT.md](PROMPT.md) §5.
- [ ] Jérémy : confirmer qu'aucune boisson alcoolisée n'est vendue en ligne. Les CGV le disent. La vente d'alcool à Genève demande une autorisation à part. Détail : [legal-sources.md](legal-sources.md).

### Livraison et service

- [ ] Jérémy : valider dans le back-office, rubrique « Livraison et horaires », les zones, frais, minimums, délais, horaires et fermetures. Enregistrer une valeur la valide. Détail : [back-office.md](back-office.md).
- [ ] Jérémy : choisir l'adresse e-mail qui reçoit les alertes du service (`ALERTE_EMAIL` : commande pas acceptée, tablette muette). Détail : [impression.md](impression.md).

### Entreprise et textes légaux

- [ ] Jérémy : donner la raison sociale, la forme juridique, le numéro IDE, le numéro TVA (si assujetti) et l'adresse e-mail du restaurant (exigée par la LCD). Détail : [legal-sources.md](legal-sources.md).
- [ ] Jérémy, avec la fiduciaire : durée de conservation des commandes, annulation avant acceptation, for juridique. Détail : [legal-sources.md](legal-sources.md).
- [ ] CGV, absence du client à la livraison : la règle est décidée (12.11.2026, PR #35) et le site l'applique déjà (livraison close sans remboursement automatique, e-mail au client, le gérant décide au cas par cas). Le paragraphe entre crochets de `src/lib/legal/cgv.ts` doit la décrire, relu par la fiduciaire. Détail : [legal-sources.md](legal-sources.md).
- [ ] Jérémy : faire relire `/mentions-legales`, `/cgv` et `/confidentialite` par un professionnel, une fois les informations ci-dessus intégrées par Claude (phase 2). Détail : [legal-sources.md](legal-sources.md).
- [ ] Jérémy : annoncer au SCAV (Service de la consommation et des affaires vétérinaires, Genève) le début de la livraison, avec la description du transport (contenants, maintien au chaud ou au froid, délai). Le formulaire en ligne de ge.ch n'a pas encore été consulté. Détail : [recherche/obligations_legales.md](recherche/obligations_legales.md).

### Comptes et services

- [ ] Jérémy : choisir le nom de domaine. restaurantlaferme.ch est encore chez Wix : ce site devient-il le site principal ou un sous-domaine (par exemple commande.restaurantlaferme.ch) ? Donner l'accès aux réglages DNS. Détail : [PROMPT.md](PROMPT.md) §12.
- [ ] Jérémy : ouvrir le compte Stripe, activer TWINT, regarder si Apple Pay et Google Pay s'activent simplement (sinon le site ne les annonce pas). Saisir dans Netlify la clé de test `sk_test_…` pour les préversions (elle ne sert qu'une fois les préversions branchées sur le projet de test, phase 3). Les clés live viennent à la bascule (phase 4).
- [ ] Jérémy : chez Infomaniak, créer l'adresse d'envoi du site et un mot de passe d'appareil, puis saisir dans Netlify `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` et `COURRIEL_EXPEDITEUR` (production et préversions). Vérifier la limite d'envoi par jour de la boîte. Détail : [comptes.md](comptes.md).
- [ ] Claude : une fois l'envoi branché, mesurer la durée d'un envoi depuis une préversion (Ohio) puis depuis Francfort. Les e-mails de commande partent avant la réponse du site : un envoi lent ralentit d'autant l'acceptation sur la tablette.
- [ ] Jérémy : passer Supabase en Pro (pas de mise en pause du projet). Au passage, créer si possible un projet de test à Zurich pour les préversions.
- [ ] Jérémy : passer Netlify en Pro (20 $ par mois pour l'équipe, prix relevé le 8.11.2026 sur netlify.com/pricing). Activer la recharge automatique des crédits, ou au moins lire les alertes à 50 %, 75 % et 90 % : crédits épuisés, le site est mis en pause. Détail : [performance.md](performance.md).
- [ ] Jérémy : régler la région des fonctions sur Francfort. Détail : [performance.md](performance.md).
  1. Sur app.netlify.com, ouvrir le projet boisterous-beijinho-c37e44.
  2. Project configuration, puis Cloud compute, puis Functions, puis Region.
  3. Configure, choisir Frankfurt (`fra`), puis Save.
  4. Redéployer : Deploys, puis Trigger deploy, puis Deploy project. Les anciens déploiements gardent l'ancienne région.
  5. Prévenir Claude.

### Sauvegardes et surveillance

- [ ] Jérémy : créer la clé de chiffrement des sauvegardes sur son Mac, la ranger dans son gestionnaire de mots de passe et sur une clé USB. Détail : [sauvegardes.md](sauvegardes.md), « Mise en place », étape 1.
- [ ] Jérémy : créer dans Supabase le rôle de lecture seule `sauvegarde` (SQL fourni), puis poser dans GitHub le secret `SUPABASE_URL_SAUVEGARDE` et la variable `SAUVEGARDE_CLE_PUBLIQUE`. Lancer une fois « Sauvegarde de la base » à la main et prévenir Claude. Détail : [sauvegardes.md](sauvegardes.md), étapes 2 et 3.
- [ ] Jérémy : sur github.com, Settings, Notifications, vérifier que les échecs d'Actions arrivent par e-mail.
- [ ] Jérémy, facultatif : contrôle Healthchecks.io pour la sauvegarde (secret `SAUVEGARDE_PING_URL`). Détail : [sauvegardes.md](sauvegardes.md), étape 4.
- [ ] Jérémy : décider de passer GitHub en Pro pour protéger la branche `main` (prix à lire dans github.com/settings/billing). Sans Pro, la règle « aucune fusion sans vérifications vertes » la remplace. Détail : [filet.md](filet.md), « Protection de la branche main ».
- [ ] Jérémy, avec la relecture juridique : citer ou non dans la déclaration de confidentialité les copies chiffrées de la base gardées 30 jours chez GitHub. Détail : [sauvegardes.md](sauvegardes.md), « Données de clients ».

### Matériel

- [ ] Jérémy : acheter une première imprimante Star mC-Print3 MCP31CI BK (Ethernet, CHF 257.38 hors port sur Toppreise le 3.11.2026), des rouleaux thermiques de 80 mm et un câble Ethernet. La deuxième une fois la première testée. Détail : [impression.md](impression.md).
- [ ] Jérémy : prévoir la tablette du comptoir, avec son chargeur à poste fixe. Détail : [tablette.md](tablette.md).
- [ ] Jérémy : préparer l'offre de lancement pour les flyers (le texte passe ensuite par Claude).

## Phase 2 : ce que Claude fait ensuite

### Données et textes

- [ ] Claude : vérifier l'import du tableau et que la vue `plats_bloquants` est vide. Le build de production en dépend. Détail : [back-office.md](back-office.md).
- [ ] Claude : vérifier que la carte en ligne ne contient aucune boisson alcoolisée. Sinon, retirer la phrase des CGV ou les plats.
- [ ] Claude : compléter les trois pages légales (passages entre crochets) avec `redaction-fr` et les faits fournis. Détail : [legal-sources.md](legal-sources.md).
- [ ] Claude : une fois Francfort actif, vérifier `/api/diagnostic/latence` sur une préversion (attendu : région `eu-central-1` et des lectures autour de 30 ms). Retirer ensuite de la déclaration de confidentialité la mention « Région de calcul des fonctions : États-Unis (Ohio) aujourd'hui » et indiquer Francfort. Netlify, Inc. reste une société américaine : la phrase sur le Swiss-U.S. Data Privacy Framework reste. Détail : [performance.md](performance.md).
- [ ] Claude : ajouter au registre de faits ce que Jérémy a confirmé (fait maison, Apple Pay et Google Pay, horaires) et mettre à jour les textes concernés. Détail : [textes-publics.md](textes-publics.md).

### Variables Netlify

Claude donne les noms et les contextes, Jérémy saisit les valeurs secrètes.

| Variable | Production | Préversions | Qui |
|---|---|---|---|
| `URL_SITE` (https://domaine, sans barre finale) | oui | non | Claude |
| `STRIPE_SECRET_KEY` | clé live, à la bascule | clé de test | Jérémy |
| `STRIPE_WEBHOOK_SECRET` | celle du webhook live | celle du webhook de test | Jérémy |
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE`, `COURRIEL_EXPEDITEUR` | oui | oui | Jérémy |
| `ALERTE_EMAIL` | oui | facultatif | Claude |
| `SECRET_COMPTES` (32 octets aléatoires) | oui, obligatoire (le build échoue sans), propre à la production | non | Jérémy |
| `PAGES_LEGALES_VALIDEES` = `1` | seulement après la relecture juridique | non | Claude |
| `SUPABASE_SECRET_KEY` | oui (déjà là) | à retirer avant la recette (phase 3), ou clé du projet de test | Jérémy |
| `BASE_DE_TEST` = `1` | jamais (le build échoue) | seulement avec la clé d'un projet Supabase de test | Jérémy |

- [ ] Jérémy et Claude : saisir les variables du tableau. Détail : [comptes.md](comptes.md).
- [x] Jérémy : migrations de la base lancées. 23 sur 23 appliquées le 12.11.2026, la dernière étant `20261123090000_plafond_codes.sql`. Toute nouvelle migration se lance par `cd ~/Desktop/LaFerme_Commande && git pull && npx supabase db push --remote`, une fois sa PR intégrée, jamais avant.
- [ ] Jérémy : se créer le premier accès gérant avec sa propre adresse e-mail, une seule fois : dans Supabase, ouvrir le projet, SQL Editor, puis exécuter `insert into personnel (email, nom, role) values ('<son adresse en minuscules>', 'Jérémy', 'gerant');`. Les autres membres (Giuseppe, l'équipe) s'ajoutent ensuite dans le back-office, rubrique « Équipe ». Le code arrive par e-mail une fois l'envoi branché (préversions et production). Sans lui, aucune connexion n'est possible sur une préversion branchée sur la vraie base.

### Stripe

- [ ] Jérémy, guidé par Claude : créer dans Stripe (mode test) un webhook vers `https://<préversion>/api/stripe/webhook` avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` et `checkout.session.expired`. Claude refait le paiement de test de bout en bout (TWINT et carte).

### Imprimantes et tablette

- [ ] Claude : ajouter chaque imprimante dans le back-office (rubrique Imprimantes) seulement quand elle est branchée et allumée, et donner son adresse à coller tout de suite (audit de sécurité, S13). Détail : [impression.md](impression.md).
- [ ] Jérémy, guidé par Claude : brancher l'imprimante en Ethernet, mettre à jour son micrologiciel, activer CloudPRNT (HTTP), coller l'adresse et régler l'intervalle à 10 secondes. Détail : [impression.md](impression.md).
- [ ] Claude : vérifier les deux tickets (pizza et cuisine) à l'acceptation d'une commande de test, puis la réimpression. Un ticket qui ne sort pas alors que la tablette dit l'imprimante « en ligne » : « Nouvelle adresse » dans le back-office et recommencer.
- [ ] Jérémy : sur la tablette, se connecter à `/tablette`, l'ajouter à l'écran d'accueil (elle s'ouvre alors en plein écran) et autoriser le son. Claude vérifie que le signal Realtime passe (relecture toutes les 15 s, pas 5). Détail : [tablette.md](tablette.md).

## Phase 3 : recette en service fictif

Avant la recette, et pas le jour de la bascule :

- [ ] Jérémy : créer un projet Supabase de test à Zurich (le plan Pro le permet), y pousser migrations et amorçage. Dans Netlify, contextes Deploy Previews et Branch deploys : remplacer `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` par celles du projet de test, puis poser `BASE_DE_TEST=1`. Sans projet de test, retirer au moins `SUPABASE_SECRET_KEY` de ces deux contextes. Tant que la clé du projet de production y reste, une préversion refuse le paiement en ligne (même de test) et n'affiche aucun code de connexion, mais ses commandes au comptoir arrivent dans la vraie base. Détail : [audits/securite.md](audits/securite.md) S1 et S2.

Hors des heures de service, avec Giuseppe ou l'équipe au comptoir, sur la préversion finale (branchée sur le projet de test) et avec Stripe en mode test.

- [ ] Équipe et Claude : une livraison payée par TWINT, une par carte, un retrait payé au comptoir. Pour chacune : ticket aux deux postes, e-mails au client, suivi à jour, statuts jusqu'à « terminée ».
- [ ] Équipe et Claude : un refus avec remboursement, un changement d'heure, une rupture du jour, une pause des commandes puis la reprise.
- [ ] Équipe et Claude : tablette éteinte trois minutes pendant un « service », ce qui doit mettre les commandes en pause et envoyer l'alerte à `ALERTE_EMAIL`. Commande laissée sans réponse : alerte après le délai réglé. Détail : [impression.md](impression.md).
- [ ] Équipe et Claude : imprimante sans papier puis débranchée. L'alerte doit apparaître sur la tablette, puis la réimpression doit marcher.
- [ ] Claude : parcours client sur un iPhone, un Android et un ordinateur, puis à 320 px de large.
- [ ] Claude, avec un iPhone de Jérémy : parcours complet avec VoiceOver (accueil, carte, fiche, panier, commande, suivi). Détail : [accessibilite.md](accessibilite.md).
- [ ] Claude, avec l'équipe : rejouer sur la vraie infrastructure les essais R-01 à R-18 de [audits/samedi-soir.md](audits/samedi-soir.md) (deux tablettes, double clic sur « Payer », pause datée puis tablette éteinte, veille de la tablette, imprimante débranchée, deux changements d'heure, temps des gestes, redéploiement pendant le service, tickets des commandes à l'avance sortis le jour J).
- [ ] Équipe et Claude : jouer trois pages de [pannes.md](pannes.md) en service fictif (imprimante sans papier, tablette figée, retour à la version précédente chez Netlify sur une préversion), avec la page imprimée près de la tablette.
- [ ] Claude : restaurer la dernière sauvegarde de GitHub dans une base Postgres vide et comparer à son empreinte. Détail : [sauvegardes.md](sauvegardes.md), « Restaurer ».
- [ ] Jérémy : noter ce qui gêne l'équipe. Claude corrige avant la bascule.

## Phase 4 : bascule

Un jour sans service, jamais pendant un service.

- [ ] **À faire avant d'activer TWINT en production (audit de sécurité 2, S2-03, pas encore codé).** Aujourd'hui, un remboursement est noté « fait » dès que Stripe l'accepte. S'il échoue ensuite (état `pending` puis `failed`, possible avec TWINT), personne ne le voit, alors que le client a reçu « remboursé ». Claude code avant la bascule : garder le remboursement « en cours » tant que Stripe ne dit pas `succeeded`, traiter l'événement `charge.refund.updated` dans le webhook (événement à ajouter chez Stripe, test et live) et alerter le restaurant sur `failed`. Essai en mode test avec la carte Stripe de remboursement en échec différé. Détail : [audits/securite-2.md](audits/securite-2.md#s2-03).
- [ ] Jérémy : accord écrit pour la mise en production.
- [ ] Jérémy (commande lancée par lui) : vider les données de test de la base. Claude prépare le fichier et dit ce qu'il fait. Avant, Jérémy dit si la commande « Moi Moi » doit rester. Contenu prévu :
  - commandes de test des préversions, avec leurs courriels et événements de paiement : `delete from courriels; delete from evenements_paiement; delete from remboursements; delete from commandes; delete from compteurs_jour;` (détail : [PROMPT.md](PROMPT.md) §11) ;
  - membre d'équipe de test : déjà retiré par la migration `20261112090000_correctifs_securite.sql` ; vérifier qu'aucune adresse en `.test` ne reste (le build de production échoue sinon) ;
  - imprimantes de test « Test pizza (préversion) » et « Test cuisine (préversion) » ;
  - ce que le build ne contrôle pas (audit de sécurité 2, S2-09) : plats et plats du jour ajoutés depuis le back-office pendant la construction (`select slug, nom, prix_centimes, jour, commandable from plats where origine <> 'carte'`), photos envoyées (`photos_plats`), comptes clients de test (`comptes` en `.test` ou `@exemple`). Claude les liste, Jérémy dit ce qui reste.
- [ ] Jérémy : saisir les clés Stripe live et le secret du webhook live. Claude crée avec lui le webhook live vers `https://<domaine>/api/stripe/webhook` (mêmes quatre événements).
- [ ] Claude : poser `PAGES_LEGALES_VALIDEES=1` (relecture faite) et `URL_SITE`.
- [ ] Jérémy et Claude : relier le domaine à Netlify (DNS), attendre le certificat HTTPS.
- [ ] Claude : retirer de `netlify.toml` la ligne `ignore` qui saute les builds de production de `main` (ajoutée le 9.11.2026 pour ne pas lancer de builds inutiles avant le lancement).
- [ ] Claude : lancer le déploiement de production, par le build Netlify seulement (jamais un build du poste publié avec `netlify deploy`, que le site refuse). Le build échoue si un plat reste à valider, si `URL_SITE` ou `SECRET_COMPTES` manque, si `BASE_DE_TEST` est posée, ou s'il reste un membre en `.test`, une imprimante de test ou une commande passée sur une préversion.
- [ ] Claude : après le déploiement, vérifier que `/api/diagnostic/latence` et `/paiement-test/<id>` répondent 404, que le cookie de session commence par `__Host-` et porte `Secure`, et relire `journal_gestion` (aucune modification de prix ou d'allergène faite par « Équipe test » sans explication).
- [ ] Claude : vérifier `https://<domaine>/api/sante` : `"etat":"ok"`, `"contexte":"production"` et une surveillance passée il y a moins d'une minute (la fonction planifiée tourne). Noter l'adresse du site en tête de [pannes.md](pannes.md), puis l'imprimer pour le comptoir.
- [ ] Jérémy : créer le moniteur UptimeRobot sur `https://<domaine>/api/sante`, alertes au restaurant et à Jérémy. Claude vérifie que l'alerte part. Détail : [filet.md](filet.md), section 2.
- [ ] Jérémy : passer une vraie commande de faible montant payée par TWINT, puis la refuser sur la tablette. Le remboursement doit arriver. Claude vérifie Stripe, la base, les tickets et les e-mails.

## Phase 5 : après la bascule

- [ ] Claude : passer l'accueil au test des résultats enrichis de Google (search.google.com/test/rich-results). Attendu : un `Restaurant` sans erreur.
- [ ] Jérémy, guidé par Claude : déclarer le site dans Google Search Console (propriété du domaine), puis y soumettre `/sitemap.xml`.
- [ ] Claude : vérifier que `/robots.txt` ouvre l'accueil, la carte et les pages légales. Le plan du site doit les lister.
- [ ] Jérémy : flyers avec un QR code vers le site (offre de lancement fournie par Jérémy, texte relu avec `redaction-fr`).
- [ ] Jérémy : garder Uber Eats en parallèle quelques mois, puis comparer le nombre de commandes et les frais. Détail : [PROMPT.md](PROMPT.md).
- [ ] Jérémy : suivre la consommation de crédits Netlify le premier mois (attendu : environ 300 sans client). Détail : [performance.md](performance.md).
- [ ] Claude, après un mois : bilan des commandes, des alertes, des coûts et des demandes de l'équipe.
- [ ] Claude, chaque trimestre : rejouer la restauration de la dernière sauvegarde dans une base vide. Chaque mois : relire la place des artefacts (avertissement à 400 Mo) et les minutes GitHub consommées. Détail : [sauvegardes.md](sauvegardes.md), [filet.md](filet.md).
