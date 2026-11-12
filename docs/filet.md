# Filet de sécurité

Ce qui empêche une erreur de partir en ligne, ce qui prévient quand quelque chose tombe, et ce qui permet de s'en remettre. Pannes en plein service : [pannes.md](pannes.md). Sauvegardes : [sauvegardes.md](sauvegardes.md).

## 1. Vérifications GitHub (intégration continue)

`.github/workflows/verifications.yml`, à chaque PR vers `main`, à chaque fusion dans `main` et à la demande. Aucun secret : rien ne parle à Supabase, Stripe ni Resend.

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

Corrigés dans ce lot, après reproduction sur le poste :

| Test | Cause trouvée | Correction |
|---|---|---|
| 14 fichiers Vitest sur 24 en échec, « Hook timed out in 10000ms » (les « délais dépassés sur des tests SQL ») | chaque fichier rejouait toutes les migrations dans sa base embarquée (1 s seul, plus de 10 s à quinze en même temps sur un poste chargé) | la base est migrée une fois par passage (`tests/unit/instantane-base.ts`), chaque fichier en recharge une copie en 0,2 s. 24 fichiers sur 24 verts en 10 s, cinq passages de suite, dont un limité à deux processus comme sur GitHub |
| Compte : « commande en invité… puis recommander », code jamais affiché (3 échecs sur 16) | le bouton « Recevoir un code » était cliquable avant que React prenne la main sur la page : le navigateur envoyait le formulaire lui-même et rechargeait la page sans rien demander. Touchait aussi un vrai client au doigt rapide | bouton inactif jusqu'à la prise en main (`FormCode.tsx`). Deux processus de test pouvaient aussi fabriquer le même e-mail : tirage au hasard ajouté. 20 sur 20 ensuite, sous une charge de 26 |
| Tablette : « une commande arrive, on l'accepte… » (mobile) | l'imprimante créée par `impression.spec.ts` passe « hors ligne » et ajoute un second bandeau `.tab-attente` : le test dépendait de l'ordre des fichiers | le test cherche le bandeau « à accepter ». Vert après `impression.spec.ts`, un seul processus |
| Axe de la tablette connectée, `document-title` (le test signalé avant ce lot) | reparu sur GitHub au deuxième passage, jamais sur le poste : le titre suivi toutes les 10 ms n'y change pas. Cause probable, pas prouvée sur le runner : après la connexion (`router.refresh`), Next 15 renvoie les métadonnées de la page en flux ; sur le runner à deux processeurs, axe passait entre le retrait du titre et son retour. Le second essai échouait ensuite sur la limite de 30 s du code pour le même e-mail | le test attend le titre « Tablette, La Ferme » avant le contrôle. S'il ne revenait jamais, le test échouerait avec ce message |
| Tests e2e de deux worktrees en même temps | port 3200 fixe | `PORT_E2E` (CLAUDE.md, Commandes) |

Reste sensible à la charge du poste : sous une charge de 33 (neuf sessions), une commande a mis plus de 5 secondes à répondre. Sur GitHub, le délai d'attente des tests est de 10 secondes (runner à deux processeurs).

### Protection de la branche `main`

Pas disponible aujourd'hui : sur un dépôt privé, la protection de branche et les règles de dépôt demandent GitHub Pro (l'API répond « Upgrade to GitHub Pro or make this repository public », docs.github.com/en/get-started/learning-about-github/githubs-plans, lu le 12.11.2026). Le prix de GitHub Pro n'est pas affiché sur github.com/pricing : à lire dans github.com/settings/billing avant de décider.

En attendant, la règle tient lieu de protection : aucune fusion sans vérifications vertes (`gh pr checks <numéro>`), écrite dans `CLAUDE.md`.

Si Jérémy passe en Pro, marche à suivre (cinq minutes) :

1. github.com/TheRemless/LaFerme_Commande, **Settings**, **Rules**, **Rulesets**, **New ruleset**, **New branch ruleset**.
2. Nom `main`. **Enforcement status** : Active. **Target branches** : Add target, Include default branch.
3. Cocher **Restrict deletions** et **Block force pushes**.
4. Cocher **Require a pull request before merging**, avec 0 approbation (Jérémy est seul à relire).
5. Cocher **Require status checks to pass**, puis ajouter `Lint, types et Vitest` et `Build (base embarquée) et Playwright`. Cocher aussi **Require branches to be up to date before merging**.
6. **Bypass list** : laisser vide. **Create**.

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

Cette semaine, avec neuf sessions qui ouvrent chacune plusieurs PR par jour, le quota peut être atteint avant la fin du mois. Suivi : github.com/settings/billing, rubrique Actions. Si besoin, passer les vérifications de `main` en manuel (elles redoublent celles de la PR, rebasée juste avant la fusion).

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

Marches à suivre détaillées : [sauvegardes.md](sauvegardes.md) (« Mise en place ») et la section 2 ci-dessus.
