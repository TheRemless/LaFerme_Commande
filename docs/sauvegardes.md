# Sauvegardes de la base

## Ce que Supabase garde lui-même

Source : supabase.com/docs/guides/platform/backups et supabase.com/pricing, lues le 12.11.2026.

| Plan | Sauvegarde automatique | Restauration |
|---|---|---|
| Free (aujourd'hui) | aucune. Supabase conseille d'exporter soi-même les données régulièrement | aucune |
| Pro (prévu au lancement, dès 25 $ par mois) | une par jour, 7 jours visibles dans Database, puis Backups | depuis le tableau de bord |
| Option PITR (Pro et plus) | retour à la seconde près, environ 100 $ par mois pour 7 jours | depuis le tableau de bord |

À savoir :

- Les fichiers envoyés dans Supabase Storage ne sont pas dans ces sauvegardes, seules leurs fiches le sont. Aujourd'hui le site n'y met rien : les photos sont dans le dépôt (`public/plats`). Si l'envoi de photos depuis le back-office les range un jour dans Storage, il faudra les sauvegarder à part.
- Une restauration Supabase ne garde pas les mots de passe des rôles créés à la main : celui du rôle `sauvegarde` (plus bas) sera à refaire.
- Un projet Free est mis en pause après une semaine sans activité.

## Notre sauvegarde, indépendante de Supabase

`.github/workflows/sauvegarde.yml`, chaque nuit à 2h23 UTC (3h23 l'hiver, 4h23 l'été à Genève), hors service.

1. Copie de la base (schémas `public` et `supabase_migrations` : toutes les tables du site et la liste des migrations passées) avec `pg_dump` 17, par un rôle qui ne peut que lire.
2. Restauration d'essai dans une base Postgres vide, détruite à la fin du passage. La copie est comparée à l'original : nombre de lignes de chaque table, droits, sécurité par ligne, règles d'accès, droits des fonctions. Le moindre écart fait échouer la sauvegarde.
3. Chiffrement avec `age` pour la clé publique de Jérémy. La copie en clair reste en mémoire et dans la base d'essai du runner GitHub, détruits après le passage.
4. Dépôt du fichier chiffré comme artefact du passage, effacé par GitHub après 30 jours. Un petit fichier `….empreinte.txt` l'accompagne (noms des tables, nombre de lignes, droits : aucune donnée de client) pour vérifier une restauration.

GitHub garde un fichier qu'il ne peut pas lire : la clé privée n'est que chez Jérémy. Si elle se perd, les sauvegardes sont illisibles. Si quelqu'un vole le compte GitHub, il peut effacer les sauvegardes mais pas les lire.

Un échec envoie une notification de GitHub au compte qui a modifié en dernier la ligne `cron` du fichier (ici TheRemless, le compte de Jérémy), selon ses réglages de notifications GitHub (Settings, Notifications, Actions).

### Place et coût

- Minutes : environ 2 par nuit, 60 par mois sur les 2 000 du plan Free (détail dans [filet.md](filet.md)).
- Place : 240 Ko par copie aujourd'hui (base de test, 25 commandes). Le plan Free garde 500 Mo d'artefacts. Le passage affiche chaque nuit la place prise et avertit au-delà de 400 Mo. À 30 copies, la limite tient tant qu'une copie fait moins de 16 Mo. Estimation non mesurée : quelques milliers de commandes par copie de 10 Mo. Quand l'avertissement arrive, raccourcir la conservation (`retention-days`) ou passer GitHub en Pro (1 Go).

### Données de clients

- Une copie contient noms, téléphones, e-mails et adresses des clients. Elle n'existe en clair que dans Supabase et, le temps d'une restauration, sur le poste qui restaure.
- Une donnée effacée à la demande d'un client reste au plus 30 jours dans les copies chiffrées.
- À trancher par Jérémy avec la relecture juridique : citer dans la déclaration de confidentialité ces copies chiffrées gardées chez GitHub (Microsoft, États-Unis), illisibles pour GitHub.

## Mise en place (Jérémy, une fois, 15 minutes)

Aucune de ces valeurs ne se colle dans une conversation.

### 1. La clé de chiffrement, sur le Mac

1. Dans le Terminal : `brew install age`, puis `age-keygen -o ~/Desktop/laferme-cle-sauvegarde.txt`.
2. La commande affiche `Public key: age1…`. Cette clé publique n'est pas secrète, la garder pour l'étape 3.
3. Ouvrir le fichier `laferme-cle-sauvegarde.txt` et copier tout son contenu dans le gestionnaire de mots de passe (note sécurisée « La Ferme, clé des sauvegardes »). En garder aussi une copie sur une clé USB rangée au restaurant ou chez Giuseppe.
4. Effacer le fichier du bureau et vider la corbeille.

### 2. Le rôle de lecture seule, dans Supabase

1. Dans le Terminal : `openssl rand -hex 24`. Le résultat est le mot de passe du rôle (des chiffres et des lettres, rien à encoder).
2. Sur supabase.com, ouvrir le projet, SQL Editor, puis exécuter (en remplaçant le mot de passe) :

```sql
create role sauvegarde with login password 'MOT_DE_PASSE' bypassrls;
grant usage on schema public, supabase_migrations to sauvegarde;
grant select on all tables in schema public, supabase_migrations to sauvegarde;
grant select on all sequences in schema public to sauvegarde;
alter default privileges for role postgres in schema public grant select on tables to sauvegarde;
alter default privileges for role postgres in schema public grant select on sequences to sauvegarde;
```

3. Effacer ensuite cette requête de la liste de l'éditeur SQL (elle contient le mot de passe).
4. Si Supabase refuse `bypassrls` : me le dire avec le message d'erreur. La solution de repli est la chaîne de connexion du rôle `postgres`, qui peut tout faire, donc à éviter si possible.

Le rôle ne peut que lire : vérifié en local, une suppression est refusée (« permission denied »). `bypassrls` lui permet de lire toutes les lignes malgré la sécurité par ligne, sans quoi `pg_dump` refuse de copier.

### 3. Les réglages dans GitHub

1. Sur supabase.com, bouton **Connect**, onglet de connexion directe, **Session pooler** : copier l'adresse (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-….pooler.supabase.com:5432/postgres`). GitHub ne parle qu'en IPv4, d'où le pooler et pas la connexion directe.
2. Dans cette adresse, remplacer `postgres.<ref>` par `sauvegarde.<ref>` et `[YOUR-PASSWORD]` par le mot de passe de l'étape 2.
3. Sur github.com/TheRemless/LaFerme_Commande, **Settings**, **Secrets and variables**, **Actions** :
   - onglet **Secrets**, **New repository secret** : nom `SUPABASE_URL_SAUVEGARDE`, valeur l'adresse de l'étape 2 ;
   - onglet **Variables**, **New repository variable** : nom `SAUVEGARDE_CLE_PUBLIQUE`, valeur la clé `age1…` de l'étape 1.
4. Onglet **Actions**, **Sauvegarde de la base**, **Run workflow**. Au bout de deux minutes, le passage doit être vert. Me prévenir : je relis le résumé (tables et lignes).

Tant que ces deux réglages manquent, la tâche de chaque nuit passe en avertissant « Sauvegarde pas encore réglée ». Si un seul des deux est posé, elle échoue.

### 4. Facultatif : être prévenu si la sauvegarde ne tourne plus

GitHub prévient d'un échec, pas d'une tâche qui ne se lance plus. Pour ça, un compte Healthchecks.io (plan gratuit Hobbyist, 20 contrôles ; usage commercial toléré selon leur FAQ, lue le 12.11.2026) :

1. Créer un contrôle « Sauvegarde La Ferme », période 1 jour, délai de grâce 2 heures, alertes vers l'e-mail du restaurant.
2. Copier son adresse de ping (`https://hc-ping.com/…`) dans un secret GitHub `SAUVEGARDE_PING_URL`.

## Restaurer

À faire avec Claude, jamais en plein service. Deux cas.

**Projet Supabase en Pro, erreur récente (moins de 7 jours)** : restaurer depuis le tableau de bord de Supabase (Database, Backups). Puis refaire le mot de passe du rôle `sauvegarde` et mettre à jour le secret GitHub.

**Projet perdu, ou Free, ou plus de 7 jours** : notre sauvegarde.

1. Sur github.com, **Actions**, **Sauvegarde de la base**, ouvrir le passage voulu, télécharger l'artefact `sauvegarde-…` et le décompresser dans un dossier vide.
2. Créer un projet Supabase neuf à Zurich (ou utiliser une base Postgres 17 vide pour vérifier d'abord). Dans son SQL Editor : `create role sauvegarde nologin;` (les droits de la copie le citent).
3. Sur le Mac, avec Postgres 17 (`brew install postgresql@17`, puis `export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH`) et `age`, dans le Terminal ouvert sur le dossier `LaFerme_Commande` :
   1. Sur supabase.com, dans le projet neuf, bouton **Connect**, **Session pooler** : copier l'adresse et **retirer** `:[YOUR-PASSWORD]`. Elle doit ressembler à `postgresql://postgres.<ref>@aws-….pooler.supabase.com:5432/postgres`, sans aucun mot de passe.
   2. Lancer, avec cette adresse entre guillemets :

```bash
scripts/exploitation/restaurer.sh laferme-base-<date>.dump.age <fichier de la clé privée> "postgresql://postgres.<ref>@aws-….pooler.supabase.com:5432/postgres"
```

   3. Le script demande « Mot de passe de la base cible ». Coller le mot de passe de la base du projet neuf (Supabase, **Project Settings**, **Database**), puis Entrée. Rien ne s'affiche pendant la saisie, c'est normal.

   Le mot de passe ne passe jamais sur la ligne de commande. Il ne reste pas dans l'historique du Terminal et les autres programmes du Mac ne le voient pas : le script le donne seulement aux commandes `psql` qui se connectent (audit de sécurité 2, S2-12). Si l'adresse contient encore un mot de passe, le script s'arrête avant de commencer et le dit. Si c'était le vrai mot de passe, il est déjà dans l'historique : le changer dans Supabase.

   Le script déchiffre dans un dossier temporaire effacé à la fin, restaure en une seule transaction (tout ou rien), retire les droits que Supabase accorde par défaut à tout objet neuf pour ne garder que ceux de la copie, puis compare le résultat à l'empreinte de la sauvegarde : « Restauration identique à l'empreinte de la sauvegarde. »
4. Brancher le site sur le nouveau projet : dans Netlify, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` du nouveau projet, puis redéployer. Refaire le rôle `sauvegarde` avec un mot de passe, et le secret GitHub.

### Essai joué le 12.11.2026

En local, sur Postgres 17.11 (Homebrew), sans Supabase ni aucune vraie donnée.

| Étape | Résultat |
|---|---|
| Base d'origine : rôles de Supabase (`supabase/local/roles.sql`), les 15 migrations, l'amorçage, les comptes de test, 25 commandes inventées | migrations passées sans erreur sur un vrai Postgres 17 |
| Rôle `sauvegarde` créé par un administrateur sans super-utilisateur (`createrole bypassrls`, comme `postgres` chez Supabase) | création acceptée ; `delete` refusé, « permission denied » |
| `sauvegarder.sh` avec ce rôle et restauration d'essai | « Copie restaurée identique à l'original (31 tables) », 247 Ko chiffrés |
| Premier essai, avant correction | refusé : « schema "public" already exists ». Corrigé : la création du schéma `public` et les droits par défaut sont retirés de la liste de restauration |
| Restauration dans une base qui a les droits par défaut de Supabase (tout à `anon` et `authenticated` sur chaque objet créé) | premier essai refusé par la comparaison : `anon` recevait tous les droits sur les vues restaurées (`plats_bloquants`…). Corrigé : objets et données, puis retrait de tous les droits, puis droits exacts de la copie, en une seule transaction. Ensuite identique, sur une grappe neuve comme sur une base existante |
| Même essai, droits d'un visiteur vérifiés dans l'original et dans les deux copies | identiques : pas de lecture des commandes ni de `plats_bloquants`, lecture de la carte, aucune écriture |
| Fichier chiffré et empreinte | aucune adresse e-mail ni prénom de client en clair (recherche dans les deux fichiers) |
| `restaurer.sh` dans une troisième base vide | « Restauration identique à l'empreinte de la sauvegarde », 25 commandes, en moins d'une seconde |
| Droits après restauration | un visiteur (`anon`) ne lit toujours pas les commandes |
| Déchiffrement avec une autre clé | refusé : « no identity matched any of the recipients » |
| Dossier en mémoire après passage | vide |

Deuxième essai le 12.11.2026, après le retrait du mot de passe de la ligne de commande (S2-12), en local sur une grappe Postgres 17.11 jetable, mot de passe de test tiré au hasard avec `@`, `:`, `/` et `%` (pour le décodage de l'adresse) :

| Étape | Résultat |
|---|---|
| Base d'origine : rôles, les 23 migrations, l'amorçage, les comptes de test | 80 plats, 37 tables |
| `sauvegarder.sh`, adresses avec mot de passe encodé comme le secret GitHub | « Copie restaurée identique à l'original (37 tables) », 351 Ko chiffrés |
| `restaurer.sh` avec le mot de passe dans l'adresse | arrêt avant tout déchiffrement, message clair |
| `restaurer.sh` avec l'adresse sans mot de passe, mot de passe tapé à l'invite (simulée par `expect`) | « Restauration identique à l'empreinte de la sauvegarde » ; un visiteur (`anon`) ne lit pas les commandes |
| Toutes les lignes de commande du poste relevées toutes les 20 ms pendant les deux scripts (6 866 lignes) | mot de passe vu 0 fois, ni en clair ni encodé. Témoin : passé en argument, il est vu 18 fois |
| Dossier en mémoire après passage | vide |

Pas encore joué : contre la vraie base Supabase (il faut les réglages de Jérémy). Le premier passage lancé à la main (étape 3.4) le fera, avec la même comparaison.

Une fois par trimestre, Claude rejoue la restauration de la dernière copie dans une base vide ([mise-en-ligne.md](mise-en-ligne.md), phase 5).
