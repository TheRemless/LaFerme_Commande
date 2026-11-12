# Filet de sécurité

Ce qui empêche une erreur de partir en ligne, ce qui prévient quand quelque chose tombe, et ce qui permet de s'en remettre. Pannes en plein service : [pannes.md](pannes.md). Sauvegardes : [sauvegardes.md](sauvegardes.md).

## 1. Vérifications GitHub (intégration continue)

`.github/workflows/verifications.yml`, à chaque PR vers `main` (sauf brouillon ou fichiers `.md` seuls), à chaque fusion dans `main` (lint, types et Vitest seulement) et à la demande. Détail et raisons : section 4. Aucun secret : rien ne parle à Supabase, Stripe ni au serveur d'envoi des e-mails.

| Job | Contenu |
|---|---|
| Lint, types et Vitest | `eslint`, `tsc --noEmit`, les tests Vitest (base embarquée, sécurité par ligne) |
| Build (base embarquée) et Playwright | `BASE_LOCALE=1 npm run build` (avec le contrôle de mise en ligne du `prebuild`), puis les tests Playwright sur Chromium, bureau et mobile |

- Les deux jobs tournent en parallèle. Un nouveau push sur la même PR annule le passage en cours.
- Caches : dépendances npm, navigateur Chromium (clé = version de Playwright), compilateur de Next (`.next/cache`).
- Un échec de Playwright dépose le rapport (captures, traces) comme artefact, gardé 7 jours.
- Mesuré le 12.11.2026 sur la PR du lot (premier passage, caches vides) : 3 min 26 d'attente en tout. Lint, types et Vitest en 1 min 38 (227 tests en 56 s), build et Playwright en 3 min 26 (170 tests sur deux processus en 2 min 27). Le cache de Chromium fait gagner 30 s aux passages suivants.

### Tests instables

Sur GitHub, un test qui échoue est rejoué une fois. S'il passe au second essai, Playwright le marque « flaky » et le passage échoue quand même (`failOnFlakyTests`). On voit donc chaque test instable, et on le corrige au lieu de relancer jusqu'au vert.

Corrigés dans ce lot, après reproduction sur le poste ou sur GitHub :

| Test | Cause trouvée | Correction |
|---|---|---|
| 14 fichiers Vitest sur 24 en échec, « Hook timed out in 10000ms » (les « délais dépassés sur des tests SQL ») | chaque fichier rejouait toutes les migrations dans sa base embarquée (1 s seul, plus de 10 s à quinze en même temps sur un poste chargé) | la base est migrée une fois par passage (`tests/unit/instantane-base.ts`), chaque fichier en recharge une copie en 0,2 s. 24 fichiers sur 24 verts en 10 s, cinq passages de suite, dont un limité à deux processus comme sur GitHub |
| Compte : « commande en invité… puis recommander », code jamais affiché (3 échecs sur 16) | le bouton « Recevoir un code » était cliquable avant que React prenne la main sur la page : le navigateur envoyait le formulaire lui-même et rechargeait la page sans rien demander. Touchait aussi un vrai client au doigt rapide | bouton inactif jusqu'à la prise en main (`FormCode.tsx`). Deux processus de test pouvaient aussi fabriquer le même e-mail : tirage au hasard ajouté. 20 sur 20 ensuite, sous une charge de 26 |
| Tablette : « une commande arrive, on l'accepte… » (mobile) | l'imprimante créée par `impression.spec.ts` passe « hors ligne » et ajoute un second bandeau `.tab-attente` : le test dépendait de l'ordre des fichiers | le test cherche le bandeau « à accepter ». Vert après `impression.spec.ts`, un seul processus |
| Axe de la tablette connectée, `document-title` (le test signalé avant ce lot, vu par quatre sessions) | reproduit sur le poste (3 échecs sur 10, le fichier lancé seul) avec un observateur des `<title>` : Next 15 envoyait le titre en flux dans `<body>` ; au `router.refresh()` de la connexion, il le retirait parfois sans le remettre. La tablette connectée restait sans titre pour de bon. Défaut du site, pas du test | métadonnées écrites dans `<head>` pour tous (`htmlLimitedBots: /.*/`, `next.config.ts`, PR à part). 12 sur 12 ensuite. Aucune page ne calcule ses métadonnées : rien de plus lent. Le test vérifie le titre avant axe |
| Tests e2e de deux worktrees en même temps | port 3200 fixe | `PORT_E2E` (CLAUDE.md, Commandes) |
| Tablette : « supplément épuisé » (bureau ou mobile, 4 tours sur 6 le 12.11.2026) | bureau et mobile tournent en même temps contre la même base et épuisaient le même supplément (Burrata). L'un le remettait « Disponible » pendant que l'autre attendait « Épuisé », et la liste de la tablette ne se relit qu'après ses propres gestes | chaque projet a son supplément et son plat (`RUPTURES` dans `tablette.spec.ts`) |
| Tablette : « refus d'une commande payée en ligne » (1 tour sur 6), « Cette commande a déjà changé » | clé d'idempotence `tablette-Bruno-<milliseconde>` : à la même milliseconde, le serveur renvoyait la même commande aux deux projets, et la seconde tablette la trouvait déjà refusée | clé avec le projet et un tirage au hasard |
| Tablette : « rupture du jour », plat pas grisé sur `/carte` (2 tours sur 10, vu une fois l'assertion resserrée sur le plat du projet) | la carte est en cache. Un rendu commencé avant la rupture et fini après la purge reste en cache jusqu'à sa régénération (`revalidate = 60`). Avant, le test acceptait n'importe quel plat épuisé, celui de l'autre projet compris | le test recharge la carte jusqu'à voir son plat épuisé (80 s au plus). Côté client, retard d'une minute au pire ; le serveur refuse le plat épuisé dès la rupture |
| Impression : file commune avec la tablette | une commande acceptée par `tablette.spec.ts` sort aussi sur l'imprimante de test : le faux client pouvait prendre ce ticket-là pour celui de sa commande. Pas reproduit en 16 tours, déduit de la file (premier arrivé, premier servi) | le faux client imprime les tickets des autres commandes et attend le sien (« oeuf a part ») |
| Commande : « paiement en ligne réussi », CM-04 « paiement refusé » (bureau et mobile ensemble, 2 tours sur 2 sur un serveur juste démarré) | page de paiement de test : « Simuler un paiement réussi » ou « refusé » cliqué avant la prise en main par React, le clic ne faisait rien. Même cas que `FormCode` | boutons inactifs jusqu'à la prise en main (`BoutonsTest.tsx`, page des préversions seulement) |
| Filet : « la route de santé répond 200 » (3 passages sur 3 sur un serveur juste démarré) | la base embarquée démarre à sa première lecture (2 s à vide, plus de 5 s sous charge) : `/api/sante` dépassait son seuil de 5 s et répondait 503. Rien de tel avec Supabase | le test attend un premier 200 (30 s au plus) avant ses vérifications |
| `compte.spec:66`, signalé le 12.11.2026 | numéro de ligne d'avant #32 : c'est « commande en invité… » (ligne 68 aujourd'hui), corrigé par #32. Branche pas rebasée | aucune ; vert sur 26 tours ici |

Reste sensible à la charge du poste : sous une charge de 33 (neuf sessions), une commande a mis plus de 5 secondes à répondre. Sur GitHub, le délai d'attente des tests est de 10 secondes (runner à deux processeurs).

### Protection de la branche `main`

Pas disponible aujourd'hui : sur un dépôt privé, la protection de branche et les règles de dépôt demandent GitHub Pro (l'API répond « Upgrade to GitHub Pro or make this repository public », docs.github.com/en/get-started/learning-about-github/githubs-plans, lu le 12.11.2026). Le prix de GitHub Pro n'est pas affiché sur github.com/pricing : à lire dans github.com/settings/billing avant de décider.

En attendant, la règle tient lieu de protection : aucune fusion sans vérifications vertes (`gh pr checks <numéro>`), écrite dans `CLAUDE.md`.

**Même limite pour le secret de la sauvegarde** (audit de sécurité 2, S2-12, point 6). Le secret `SUPABASE_URL_SAUVEGARDE` lit toutes les données de la base. Sur ce plan, n'importe quel workflow poussé sur n'importe quelle branche du dépôt peut le lire : un fichier ajouté dans `.github/workflows/` suffit, sans PR ni fusion. Les PR de Dependabot et des forks n'y ont pas accès. Une personne ou une session qui peut pousser sur le dépôt, oui. Le remède est un environnement protégé limité à `main`, qui ne donne le secret qu'aux passages sur `main`. Sur un dépôt privé, il demande GitHub Pro (docs.github.com, « Managing environments for deployment », lu le 12.11.2026). En attendant, seuls Jérémy et ses sessions Claude poussent sur le dépôt, et une PR qui ajoute ou modifie un fichier de `.github/workflows/` se relit avant sa fusion pour vérifier qu'elle ne lit aucun `secrets.`.

Si Jérémy passe en Pro, en plus des règles de branche ci-dessous : **Settings**, **Environments**, **New environment** `sauvegarde`, **Deployment branches and tags** limité à `main`, y déplacer le secret `SUPABASE_URL_SAUVEGARDE`, puis ajouter `environment: sauvegarde` au job de `.github/workflows/sauvegarde.yml`.

Si Jérémy passe en Pro, marche à suivre (cinq minutes) :

1. github.com/TheRemless/LaFerme_Commande, **Settings**, **Rules**, **Rulesets**, **New ruleset**, **New branch ruleset**.
2. Nom `main`. **Enforcement status** : Active. **Target branches** : Add target, Include default branch.
3. Cocher **Restrict deletions** et **Block force pushes**.
4. Cocher **Require a pull request before merging**, avec 0 approbation (Jérémy est seul à relire).
5. Cocher **Require status checks to pass**, puis ajouter `Lint, types et Vitest` et `Build (base embarquée) et Playwright`. Cocher aussi **Require branches to be up to date before merging**.
6. **Bypass list** : laisser vide. **Create**.

### Actions permises (Jérémy, deux minutes, possible sur le plan Free)

Audit de sécurité 2, S2-12, point 5. Aujourd'hui le dépôt accepte n'importe quelle action, désignée par une étiquette que son auteur peut déplacer. Les workflows n'utilisent que des actions de GitHub (`actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`), toutes épinglées par l'empreinte complète de leur commit (vérifié le 12.11.2026 dans `verifications.yml` et `sauvegarde.yml`). Les deux réglages ne cassent donc rien. Ils empêchent qu'une action d'un inconnu, ou une action désignée par une étiquette, entre plus tard sans qu'on le voie. Dependabot n'est pas touché : ses passages ignorent ces réglages (docs.github.com, « Dependabot on GitHub Actions runners », lu le 12.11.2026).

1. github.com/TheRemless/LaFerme_Commande, **Settings**, puis dans la colonne de gauche **Actions**, **General**.
2. Bloc **Actions permissions** : choisir **Allow TheRemless, and select non-TheRemless, actions and reusable workflows**.
3. Cocher **Allow actions created by GitHub**. Laisser décochés « Allow actions by Marketplace verified creators » et vide la liste des actions permises.
4. Cocher **Require actions to be pinned to a full-length commit SHA**.
5. **Save**. Puis relancer un passage pour vérifier : onglet **Actions**, **Vérifications**, **Run workflow**, branche `main`. Il doit rester vert.

Libellés lus dans docs.github.com, « Managing GitHub Actions settings for a repository », le 12.11.2026. Si l'écran diffère, me l'envoyer en capture.

## 2. Surveillance du site

### Route de santé

`GET /api/sante`, sans connexion, jamais en cache, aucune donnée personnelle :

```json
{
  "etat": "ok",
  "heure": "2026-11-14T19:30:00.000Z",
  "version": "abc1234",
  "contexte": "production",
  "base": { "ok": true, "ms": 42 },
  "surveillance": { "dernier_passage": "…", "il_y_a_s": 30, "en_retard": false },
  "service": { "en_cours": true },
  "tablette": { "dernier_signe": "…", "il_y_a_s": 20, "muette": false }
}
```

| `etat` | Réponse | Quand |
|---|---|---|
| `ok` | 200 | la base répond en moins de 5 secondes et, en production, la surveillance est passée il y a moins de 5 minutes |
| `degrade` | 503 | production seulement : surveillance arrêtée depuis plus de 5 minutes (plus d'alerte « pas acceptée » ni de pause automatique) |
| `panne` | 503 | la base ne répond pas |

La tablette muette pendant le service est signalée (`muette`) sans faire passer le site en 503 : la surveillance met déjà les commandes en pause et prévient le restaurant. `version` est le commit en ligne (pour un retour arrière, [pannes.md](pannes.md)). Une instance garde sa réponse 15 secondes : une rafale d'appels ne coûte pas une lecture de la base chacun.

### Qui interroge la route : trois moyens comparés

Relevés du 12.11.2026, pages officielles.

| Moyen | Ce qu'il fait | Prix | Limites |
|---|---|---|---|
| Tâche planifiée GitHub | un job toutes les N minutes qui appelle la route, e-mail de GitHub si elle échoue | compris dans les 2 000 minutes du plan Free | intervalle de 5 minutes au plus court, tâches retardées ou abandonnées aux heures chargées (docs.github.com, « Events that trigger workflows »). Chaque passage compte au moins une minute : toutes les 5 minutes, 8 640 minutes par mois, quatre fois le quota. Toutes les heures, 720 minutes et une alerte jusqu'à une heure trop tard |
| Service externe : UptimeRobot Free | appel toutes les 5 minutes depuis l'extérieur, alerte quand la route ne répond plus ou répond 503 | 0 $ | 50 moniteurs, usage commercial autorisé (« Good for personal and commercial projects », uptimerobot.com/pricing). Pas de contrôle « heartbeat » en gratuit (dès 9 $ par mois en annuel). Alerte par e-mail en gratuit : pas lisible sur la page des prix, à confirmer à l'inscription |
| Journaux Netlify | lecture des erreurs après coup | compris | aucune alerte. Journaux de fonctions gardés au moins 24 heures, transfert des journaux (Log Drains) réservé à Enterprise (docs.netlify.com, lu le 12.11.2026) |

Better Stack (10 moniteurs gratuits) se présente comme gratuit « for personal projects » : écarté pour un restaurant.

**Recommandation : UptimeRobot Free sur `/api/sante`**, toutes les 5 minutes, alerte à l'adresse du restaurant et à Jérémy. Il voit ce que voit un client (site, base) et la surveillance arrêtée. La tâche planifiée GitHub ne sert qu'à la sauvegarde, une fois par nuit. Pour savoir si la sauvegarde ne tourne plus du tout, Healthchecks.io (plan Hobbyist gratuit, [sauvegardes.md](sauvegardes.md)).

Coût côté Netlify : 8 640 appels par mois, chacun une lecture de la base. Environ 13 crédits par mois depuis l'Ohio, 4 depuis Francfort (même calcul que [performance.md](performance.md) : 0,45 s puis 0,1 s par appel à 1 Go, plus 2 crédits pour 10 000 requêtes).

À créer par Jérémy (compte à son nom, au lancement, pas avant : la route de production n'existe qu'une fois le site en ligne) :

1. Compte sur uptimerobot.com, plan Free.
2. **New monitor**, type HTTP(s), adresse `https://<domaine>/api/sante`, intervalle 5 minutes.
3. Alerte : l'e-mail du restaurant (`ALERTE_EMAIL`) et celui de Jérémy. Installer l'application UptimeRobot sur le téléphone de Jérémy pour les notifications.
4. Me prévenir : je coupe la base d'une préversion pour vérifier que l'alerte part.

## 3. Mises à jour des dépendances

`.github/dependabot.yml` : chaque lundi à 6h, heure de Genève.

- npm : une PR groupée pour toutes les versions mineures et correctives, une autre pour les majeures. Trois PR ouvertes au plus. Next, React, eslint-config-next et `@types/node` ne changent pas de version majeure seuls : ils se suivent et se font à la main.
- Actions GitHub (les actions sont épinglées par leur empreinte de commit) : une PR groupée, deux au plus.
- Chaque PR lance les vérifications. Pas de préversion Netlify pour ces PR (`netlify.toml`, `ignore`) : la file de builds reste aux sessions.
- Les PR de Dependabot n'ont accès à aucun secret GitHub (docs.github.com, « Troubleshooting Dependabot on GitHub Actions »). Elles se fusionnent comme les autres : vérifications vertes, `code-review`.

## 4. Coût

### Minutes GitHub Actions

Plan Free, dépôt privé : 2 000 minutes par mois (github.com/pricing). Chaque job est arrondi à la minute supérieure (docs.github.com/en/billing/reference/actions-runner-pricing). Runner Linux d'un dépôt privé : 2 processeurs, 8 Go (docs.github.com, « GitHub-hosted runners »). Au-delà du quota, GitHub facture à la minute (0,006 $ en Linux) ou bloque les jobs, selon le budget réglé dans github.com/settings/billing (comportement exact non vérifié).

| Poste | Par passage | Par mois (estimation) |
|---|---|---|
| Vérifications d'un push sur une PR, ou d'une fusion | 6 minutes facturées (2 + 4, chaque job arrondi) | voir ci-dessous |
| Sauvegarde | 2 minutes | 60 |
| Dependabot (deux à trois PR par semaine, deux passages chacune avec le rebase) | 6 minutes par passage | environ 150 |

Hypothèses : en construction, une vingtaine de PR par mois avec trois pushes chacune, plus une fusion chacune, soit 80 passages : 480 minutes, environ 700 avec la sauvegarde et Dependabot, un tiers du quota. Après le lancement, une dizaine de PR (40 passages) : environ 450 minutes par mois.

**Le quota est celui du compte, pas du dépôt.** Le 12.11.2026 à 07:47 UTC, GitHub a cessé de lancer les jobs (« recent account payments have failed or your spending limit needs to be increased »). Relevé des jobs du 1er au 12 novembre, API GitHub, chaque job arrondi à la minute, tous sur Linux :

| Dépôt, flux | Passages | Minutes |
|---|---|---|
| Secrettravelandtour, CI | 107 | 1 154 |
| Site_Anais, CI | 157 | 354 |
| Site_Anais, IndexNow (à chaque push) | 95 | 285 |
| Site_Anais, taux de change | 11 | 13 |
| LaFerme_Commande, Vérifications et Dependabot | 40 | 237 |
| **Total** | 410 | **2 043** |

Ce dépôt a pris 12 % du quota, à 6,2 minutes par passage comme estimé. 759 minutes ont été consommées le 12 novembre seul. Le compteur exact (et sa date de remise à zéro) n'est lisible que dans github.com/settings/billing : l'API demande un droit que la session n'a pas.

Réglages du flux depuis ce relevé, pour tenir le quota :

- une PR en brouillon ne lance rien ; « Ready for review » lance les vérifications ;
- une PR qui ne touche que des fichiers `.md` ou `maquette/` ne lance rien (les tests lisent `docs/carte-proposee.json` et `docs/validation-carte.xlsx`, qui déclenchent donc les vérifications) ;
- après une fusion, `main` ne repasse que lint, types et Vitest (2 minutes au lieu de 6) : Playwright a tourné sur la PR. Il se relance à la main (Actions, Vérifications, Run workflow) ;
- un nouveau push sur une PR annule le passage en cours (déjà en place).

### Netlify

- Préversions : gratuites en crédits (docs.netlify.com, « Credit-based pricing plans », lu le 12.11.2026). Ce lot n'en ajoute pas, il en retire (Dependabot).
- Route de santé interrogée par UptimeRobot : 13 crédits par mois depuis l'Ohio, 4 depuis Francfort.
- Rien d'autre : la sauvegarde parle directement à Supabase, sans passer par Netlify.

### Supabase

La sauvegarde lit la base une fois par nuit, par le pooler partagé. Rien de facturé à part sur Free comme sur Pro.

## 5. Réglages à poser par Jérémy

| Où | Nom | Valeur | Pour |
|---|---|---|---|
| GitHub, secret Actions | `SUPABASE_URL_SAUVEGARDE` | adresse du pooler avec le rôle `sauvegarde` | sauvegarde |
| GitHub, variable Actions | `SAUVEGARDE_CLE_PUBLIQUE` | clé publique `age1…` | sauvegarde |
| GitHub, secret Actions (facultatif) | `SAUVEGARDE_PING_URL` | adresse de ping Healthchecks.io | sauvegarde qui ne tourne plus |
| Supabase, SQL Editor | rôle `sauvegarde` | [sauvegardes.md](sauvegardes.md), étape 2 | sauvegarde |
| UptimeRobot | moniteur `/api/sante` | au lancement | site ou base tombés |
| GitHub, Settings, Notifications | Actions : e-mail pour les échecs | coché | échec d'une sauvegarde |
| GitHub, dépôt, Settings, Actions, General | Allow TheRemless, and select non-TheRemless, actions… puis Allow actions created by GitHub | coché | seules les actions de GitHub (S2-12) |
| GitHub, dépôt, Settings, Actions, General | Require actions to be pinned to a full-length commit SHA | coché | aucune action par étiquette (S2-12) |

Marches à suivre détaillées : [sauvegardes.md](sauvegardes.md) (« Mise en place ») et la section 2 ci-dessus.
