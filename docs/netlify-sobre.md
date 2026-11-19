# Netlify sobre (19.11.2026)

Demande de Jérémy du 19.11.2026 : « Netlify est débloqué mais fais attention à l'utilisation ». Ce document chiffre ce qui consomme des crédits Netlify, et ce que la PR « Netlify sobre » change.

## Comment Netlify compte (doc officielle, lue le 19.11.2026)

Sources :
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ (mise à jour du 12.8.2026) ;
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/ ;
- https://docs.netlify.com/build/functions/usage-and-billing/ ;
- https://docs.netlify.com/build/functions/scheduled-functions/ ;
- https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/.

| Poste | Crédits | Ce que dit la doc |
|---|---|---|
| Mise en production réussie | 15 par déploiement | « each successful production deploy consumes 15 credits ». Un déploiement raté ou un retour à une production précédente : 0. |
| Préversion (Deploy Preview) ou déploiement de branche | **0** | Tableau de « How credits work » : « 0 credits ». |
| Minutes de build | pas comptées | FAQ : « Build minutes are not calculated as their own metric ». |
| Calcul des fonctions (fonction planifiée comprise) | 10 par Go-heure | Mémoire par défaut 1 Go. Non trouvé : durée minimale facturée par appel, arrondi. |
| Requêtes | 2 pour 10 000 | Comptées aussi sur les préversions : « as well as to any active branch deploys and Deploy Previews ». |
| Bande passante | 20 par Go | Préversions : non trouvé. |
| Formulaires | 0 | Changelog d'avril 2026. Le site n'utilise pas les formulaires Netlify. |

- **Plans :** Free 300 crédits par mois, sans dépassement possible ; Personal 1 000 ; Pro à partir de 3 000.
- **Crédits épuisés :** « all of your web projects (sites/apps) are paused », et les visiteurs voient « Site not available ».
- **Fonction planifiée :** elle ne tourne qu'en production. « Deploy Previews and branch deploys won't trigger them automatically. »

Non vérifié (aucun accès au compte, et aucune valeur secrète lue) : le plan actuel du compte, le solde de crédits, et l'existence d'une production publiée.

## Ce qui consomme aujourd'hui (avant cette PR)

| Poste | Aujourd'hui | Crédits par mois | Source |
|---|---|---|---|
| Préversions | Une par poussée sur chaque PR, sauf Dependabot. 212 PR ouvertes du 13 au 16.11 (API GitHub). Builds de 1 min 03 à 1 min 29 (10 dernières PR, statuts Netlify) | 0 pour les builds. Requêtes et calcul seulement quand quelqu'un ouvre une préversion : non mesuré, faible | doc ci-dessus |
| Production | Sautée depuis le 9.11 (#18) | 0 | `netlify.toml` |
| Fonction planifiée `surveillance` | Chaque minute, jour et nuit, **seulement si une production publiée la contient** | 0 si aucune production publiée. Sinon environ 102 en Ohio et environ 9 de requêtes (estimation du lot 8f, [performance.md](performance.md)) | voir « À vérifier par Jérémy » |
| Formulaires | aucun | 0 | code |

À vérifier par Jérémy : la fonction planifiée est arrivée sur `main` le 8.11 à 15h53 (#10). Les builds de production ne sont sautés que depuis le 9.11 à 7h52 (#18). Si une production a été **publiée** entre-temps, elle appelle le site chaque minute. C'est peu probable, car le build de production refuse de finir tant qu'un plat reste à valider (`scripts/verifier-mise-en-ligne.ts`, depuis le lot 2), mais ce n'est pas vérifié. Voir plus bas.

## Ce que la PR change

### 1. Préversion sur demande seulement

`netlify.toml` lance `scripts/netlify/ignorer-build.sh`. Une préversion ne se construit que si :
- le **dernier commit** poussé contient `[preview]` dans son message ;
- ou la PR porte le **label `preview`** (lu sur l'API publique de GitHub, sans jeton).

Sinon, elle est sautée, et notamment pour les PR de documentation, de SQL ou de tests, et toutes les PR de Dependabot. Les vérifications GitHub (lint, types, Vitest, Playwright sur la base embarquée) testent **toutes** les PR, avec ou sans préversion : c'est le filet ([filet.md](filet.md)).

Demander une préversion :
1. **Le plus simple** : un commit dont le message contient `[preview]`. Pour une PR déjà poussée :
   ```bash
   git commit --allow-empty -m "Préversion demandée [preview]"
   ```
   puis `git push`.
2. **Avec le label** : `gh pr edit <numéro> --add-label preview`, puis pousser un commit (même vide). Netlify ne relance pas un build quand on pose seulement un label : il construit à la poussée suivante, et lit le label à ce moment-là.
3. **Une seule fois, la première** (chef ou Jérémy) : créer le label dans le dépôt.
   ```bash
   gh label create preview --color 1d76db --description "Construire une préversion Netlify"
   ```

Si l'API de GitHub ne répond pas (réseau, limite de 60 lectures par heure sans jeton), la préversion est sautée. Le commit `[preview]` reste possible.

Effet en crédits : **à peu près nul**, puisqu'une préversion ne coûte rien à construire. Le gain est ailleurs :
- la file de builds reste libre (un build supplémentaire en parallèle coûte 40 $ par mois) ;
- il n'y a plus de dizaines d'adresses de préversion branchées sur la **vraie base** (CLAUDE.md, « Previews sur la base de production ») ;
- personne ne les ouvre par erreur, ce qui économise requêtes et calcul.

### 2. Fonction planifiée aux heures utiles

- **Avant :** chaque minute, jour et nuit, soit 43 200 appels du site par mois.
- **Après :** toutes les 2 minutes de 8h à 13h59 et de 15h à 22h59 UTC (`*/2 8-13,15-22 * * *`). La fonction sort **tout de suite**, sans appeler le site, hors des fenêtres de Genève : 10h à 15h et 17h30 à minuit, tous les jours. Les services (11h à 14h et 18h30 à 23h, mardi à samedi) sont couverts avec une marge, en heure d'hiver comme d'été (testé minute par minute sur un an : `tests/unit/fenetre-surveillance.test.ts`).
- **Règles tenues :**
  - refus automatique (C13) : une commande est refusée entre 15 et 17 minutes, jamais avant ;
  - « tablette muette » (3 minutes) : alerte et pause entre 3 et 5 minutes ;
  - les tâches du jour (remise du jour, cagnotte) passent au premier tour de la journée, comme avant.
- **Santé :** `/api/sante` ne déclare la surveillance « en retard » que si sa fenêtre est ouverte depuis plus de 5 minutes. La nuit, son silence est normal : pas de 503 ni d'alerte du service de disponibilité.
- **Limite :** une ouverture exceptionnelle **hors** de ces fenêtres (entre 15h et 17h30, ou après minuit) n'aurait ni refus automatique ni alerte « tablette muette ». La tablette garde sa propre surveillance à chaque relecture. Il faut alors élargir `FENETRES_SURVEILLANCE` et la planification (`src/lib/fenetre-surveillance.ts`).

### 3. Production : sautée jusqu'à « bascule », puis seulement sur demande

- **Aujourd'hui :** `main` reste sautée (`PRODUCTION_LANCEE=non`).
- **À la bascule :** une seule ligne à changer, écrite dans [mise-en-ligne.md](mise-en-ligne.md). Ensuite, `main` ne se construit que si le dernier commit porte `[production]`.
- **Pourquoi :** chaque mise en production coûte 15 crédits. Au rythme actuel (environ 30 PR par jour la semaine du 13.11), une production à chaque fusion coûterait jusqu'à **450 crédits par jour** : les 3 000 crédits du plan Pro seraient épuisés en une semaine, et le site mis en pause.

Mettre en production après la bascule : fusionner avec la marque dans le message de fusion.
```bash
gh pr merge <numéro> --merge --subject "Merge pull request #<numéro> [production]"
```
Hors des heures de service (CLAUDE.md).

## Chiffrage avant et après (crédits par mois)

Estimation pour la fonction planifiée, à partir du lot 8f ([performance.md](performance.md)) : un passage coûte environ 0,0024 crédit en Ohio (102 crédits pour 43 200 passages) et 0,0005 depuis Francfort.
- **Après :** 30 passages par heure, 11,5 heures par jour, 30,4 jours, soit environ 10 500 appels du site par mois.
- **S'y ajoutent** environ 2 300 réveils hors fenêtre, qui sortent aussitôt (estimés à moins d'1 crédit).

| Poste | Avant | Après | Remarque |
|---|---|---|---|
| Préversions (builds) | 0 | 0 | doc : 0 crédit |
| Préversions ouvertes (requêtes, calcul) | faible, non mesuré | encore plus faible | seulement celles demandées |
| Surveillance planifiée, Ohio (après la bascule) | environ 111 (102 de calcul et 9 de requêtes) | environ 28 (25 de calcul, 2 de requêtes, moins d'1 de réveils) | estimation |
| Surveillance planifiée, Francfort | environ 29 | environ 8 | estimation |
| Mise en production (après la bascule) | 15 par fusion, jusqu'à 450 par jour au rythme du 13.11 | 15 par mise en production demandée (par exemple 2 par semaine, environ 130 par mois) | règle `[production]` |
| Total sans client (lot 8f, Pro et Francfort, imprimantes à 10 s) | environ 300 | environ 285, plus les mises en production choisies | la surveillance n'en était qu'une part |

Non vérifié : les durées réelles des fonctions chez Netlify. Les chiffres viennent des mesures depuis les préversions et des hypothèses du lot 8f. Le premier mois après la bascule, relever la répartition par poste (Usage & billing, « Credit usage breakdown », ligne Compute).

## Alerte de consommation : réglages de Jérémy (son compte, pas touché ici)

D'après la doc (pages « Monitor usage », « Configure auto recharge » et la FAQ, lues le 19.11.2026) :
- **Alertes automatiques :** Netlify envoie un e-mail et une notification dans l'application à 50 %, 75 % et 100 % des crédits du mois. La FAQ cite aussi 90 %. Les seuils ne se règlent pas : non trouvé dans la doc.
- **Plafond de dépenses :** il n'en existe pas, sauf pour l'IA. Seule protection : ne pas activer la recharge automatique, mais alors, crédits épuisés, le site est mis en pause.

Pas à pas :
1. Sur app.netlify.com, ouvrir l'équipe, puis **Usage & billing**.
2. **Credit usage breakdown** (onglet General) : vérifier la ligne **Compute**, puis **Account usage insights** pour la courbe par jour. À regarder une fois par semaine le premier mois.
3. Vérifier que l'adresse e-mail du propriétaire de l'équipe est bien lue : les alertes à 50, 75 et 100 % y arrivent.
4. **Au lancement, pas avant** : **Credit balance**, puis **Configure auto recharge**, choisir **Enabled** et confirmer. Pro : 1 500 crédits pour 10 $, Personal : 500 pour 5 $, impossible sur Free. Sans elle, crédits épuisés pendant un service, le site s'arrête.
5. En option, plan Pro seulement : l'application Netlify pour Slack, pour recevoir les alertes dans Slack.
6. Vérifier la fonction planifiée :
   - ouvrir le projet boisterous-beijinho-c37e44, puis **Deploys** : y a-t-il une production marquée **Published** ?
   - puis **Logs**, **Functions** : la fonction `surveillance` a-t-elle des appels ?
   - Si oui (production publiée entre le 8.11 à 15h53 et le 9.11 à 7h52), elle consomme chaque minute. Pour l'arrêter sans frais, ouvrir dans **Deploys** une production plus ancienne que le 8.11 à 15h53 et choisir **Publish deploy**. Un retour à une production précédente ne coûte aucun crédit (doc : « rolling back a production deploy to a previous production deploy does not consume credits »).
   - Me prévenir de ce qui a été trouvé.
