# Pannes : quoi faire en plein service

Une page par panne. Chacune dit quoi faire dans les deux premières minutes, puis ensuite, une fois le coup de feu passé. Pas besoin d'être développeur.

À imprimer et à garder près de la tablette. L'adresse du site est notée ici au lancement : `https://__________________`.

## Le geste qui sert presque toujours : « commandes par téléphone »

Sur la tablette, toucher **Pause, délai, ruptures**, puis **Pause jusqu'à reprise**.

Les clients voient alors sur le site : « Les commandes en ligne sont en pause. Commandez par téléphone au 022 792 16 89. » Le site n'accepte plus aucune commande en ligne. Les commandes déjà reçues restent sur la tablette.

Pour rouvrir : **Pause, délai, ruptures**, puis **Reprendre les commandes**.

Tablette en panne ? Le même geste se fait depuis n'importe quel téléphone : ouvrir `https://<adresse du site>/tablette`, entrer l'e-mail d'un membre de l'équipe, recevoir le code par e-mail, puis **Pause, délai, ruptures**.

Ce geste ne marche que si le site et la base répondent. Sinon, voir plus bas : le site affiche déjà le numéro de téléphone à chaque commande refusée.

## Savoir d'où vient la panne (30 secondes)

Sur un téléphone en 4G (pas le Wi-Fi du restaurant), ouvrir `https://<adresse du site>/api/sante`.

| Ce qui s'affiche | Ce que ça veut dire | Page |
|---|---|---|
| Rien, ou « Site not available » | Le site est tombé, ou les crédits Netlify sont épuisés | [Le site ne répond plus](#le-site-ne-répond-plus), [Crédits Netlify épuisés](#les-crédits-netlify-sont-épuisés) |
| `"etat":"panne"` | Le site marche, la base non | [La base ne répond plus](#la-base-ne-répond-plus) |
| `"etat":"degrade"` | La surveillance automatique est arrêtée : plus d'alerte ni de pause automatique | Prévenir Jérémy, le service continue |
| `"etat":"ok"` | Le site et la base vont bien : la panne est sur place (tablette, imprimante, Wi-Fi) ou chez Stripe | [Tablette](#la-tablette-est-figée), [Imprimante](#limprimante-ne-sort-rien), [Stripe](#stripe-ne-répond-plus) |

Pages d'état officielles des services : Netlify `netlifystatus.com`, Supabase `status.supabase.com`, Stripe `status.stripe.com`.

## Le site ne répond plus

**Signes** : la page ne s'ouvre pas, ou affiche une erreur, chez vous comme en 4G. La tablette affiche « Pas de connexion ». Les imprimantes ne sortent plus rien.

**En deux minutes**

1. Vérifier en 4G : si le site s'ouvre en 4G, c'est le Wi-Fi du restaurant (voir [La tablette est figée](#la-tablette-est-figée)).
2. « Site not available » : voir [Les crédits Netlify sont épuisés](#les-crédits-netlify-sont-épuisés).
3. Le site vient d'être mis à jour (dans l'heure) : voir [Une mauvaise version a été mise en ligne](#une-mauvaise-version-a-été-mise-en-ligne).
4. Sinon : prendre les commandes au téléphone et sur papier. Le site ne peut rien afficher tant qu'il est tombé. Prévenir Jérémy.

**Ensuite** : regarder `netlifystatus.com`. Une panne de Netlify se règle chez eux, on attend. Les commandes déjà acceptées sont en base, rien n'est perdu. Une commande payée pendant la panne, s'il y en a, apparaît sur la tablette au retour du site.

## La base ne répond plus

**Signes** : l'accueil et la carte s'affichent, mais chaque commande est refusée avec « La commande n'est pas passée. Réessayez dans un instant ou appelez-nous au 022 792 16 89. » La tablette affiche « Pas de connexion » ou ne se met plus à jour. `/api/sante` affiche `"etat":"panne"`.

**En deux minutes**

1. Prendre les commandes au téléphone. Le site donne déjà le numéro à chaque client refusé : pas besoin de mettre en pause (ce serait impossible, la pause est enregistrée dans la base).
2. Les tickets déjà imprimés restent valables. Préparer ce qui est en cours.
3. Prévenir Jérémy.

**Ensuite** (Jérémy)

1. Regarder `status.supabase.com`.
2. Ouvrir le projet sur supabase.com. Tant que le projet est sur le plan gratuit, il est mis en pause après une semaine sans activité : bouton de reprise dans le tableau de bord, puis quelques minutes d'attente.
3. Si des données sont perdues ou abîmées : ne rien effacer, ouvrir une session Claude et suivre [sauvegardes.md](sauvegardes.md), « Restaurer ».

## Stripe ne répond plus

**Signes** : les clients qui paient en ligne voient « Le paiement en ligne ne répond pas. Réessayez dans un instant ou appelez-nous au 022 792 16 89. » La tablette affiche « Remboursement pas passé » après un refus. `/api/sante` affiche `"etat":"ok"`.

**En deux minutes**

1. Rien à couper : le paiement au comptoir marche toujours (jusqu'à CHF 100 par commande).
2. Si la panne dure et que les clients appellent, mettre en pause (geste du début de page).

**Ensuite**

- Regarder `status.stripe.com`.
- Un paiement fait juste avant la panne peut arriver en retard : Stripe renvoie ses messages au site une fois revenu, la commande apparaît alors sur la tablette.
- Remboursements pas passés : ouvrir **Terminées**, puis **Rembourser** sur chaque commande signalée, une fois Stripe revenu. Un second appui ne rembourse pas deux fois.

## L'imprimante ne sort rien

**Signes** : la tablette affiche le nom de l'imprimante avec « hors ligne », « plus de papier » ou « capot ouvert ». Ou rien ne sort alors que la tablette dit l'imprimante en ligne.

**En deux minutes**

1. Sur la commande, toucher **Ticket** : le ticket s'affiche en grand sur la tablette. La cuisine peut lire l'écran.
2. Regarder l'imprimante : papier, capot fermé, câble réseau branché des deux côtés, voyant allumé. L'éteindre et la rallumer.
3. Les tickets ne sont pas perdus : ils attendent et sortent tous dans l'ordre au retour de l'imprimante. Ne pas réimprimer avant, sinon ils sortent en double.

**Ensuite**

- Un ticket manque après le retour : **Réimprimer** sur la commande (tout ou un seul poste).
- La tablette dit « en ligne » mais rien ne sort : Jérémy, dans le back-office, rubrique Imprimantes, **Nouvelle adresse**, puis la coller dans l'imprimante ([impression.md](impression.md)).

## La tablette est figée

**Signes** : plus de nouvelle commande ni de son, l'écran ne bouge plus, ou le bandeau « Pas de connexion depuis… ».

**En deux minutes**

1. Vérifier le Wi-Fi de la tablette.
2. Fermer l'application de la tablette et la rouvrir depuis l'écran d'accueil. Toucher **Démarrer le service** (sinon pas de son).
3. Pas mieux : prendre un téléphone, ouvrir `https://<adresse du site>/tablette`, se connecter avec l'e-mail d'un membre de l'équipe et le code reçu, puis **Démarrer le service**. Ce téléphone fait la tablette le temps de la panne.

**Ensuite**

- Après trois minutes sans signe de la tablette pendant le service, le site se met en pause tout seul et envoie un e-mail d'alerte. La tablette affiche alors « Pause automatique ». Une fois la tablette revenue : **Pause, délai, ruptures**, puis **Reprendre les commandes**.
- Les commandes arrivées pendant la panne sont dans la liste **À accepter**. Les accepter dans l'ordre.

## Une mauvaise version a été mise en ligne

**Signes** : quelque chose ne marche plus juste après une mise à jour du site. Le champ `"version"` de `/api/sante` donne la version en ligne.

**En deux minutes** (Jérémy, sur un ordinateur ou un téléphone)

1. Ouvrir app.netlify.com, le projet boisterous-beijinho-c37e44, puis **Deploys**.
2. Ouvrir le déploiement réussi juste avant celui qui pose problème.
3. Toucher **Publish deploy**. Le retour est immédiat, sans nouveau build.
4. Dans la liste **Deploys**, toucher **Lock to stop auto publishing** : la prochaine fusion ne remettra pas la mauvaise version en ligne.

**Ensuite** : prévenir Claude avec l'heure et ce qui ne marchait plus. Une fois la correction en ligne, **Unlock** dans la même liste pour reprendre les mises à jour automatiques. Attention : Netlify ne revient pas en arrière sur la base. Si la mauvaise version venait avec une migration de base, le dire à Claude, l'ancienne version du site peut ne pas aller avec la base modifiée.

Source : docs.netlify.com/deploy/manage-deploys/manage-deploys-overview, lue le 12.11.2026.

## Les crédits Netlify sont épuisés

**Signes** : le site affiche « Site not available ». Les deux autres sites du même compte Netlify aussi. Netlify a envoyé des e-mails à 50, 75, 90 puis 100 % des crédits.

**En deux minutes** (Jérémy)

1. Ouvrir app.netlify.com, puis la facturation de l'équipe (Billing).
2. Acheter un pack de crédits, ou activer la recharge automatique. Sur Pro : 1 500 crédits pour 10 $ (relevé le 8.11.2026). Le site revient une fois les crédits ajoutés.
3. En attendant : commandes au téléphone.

**Ensuite** : activer la recharge automatique pour que ça ne se reproduise pas, et demander à Claude d'où vient la consommation ([performance.md](performance.md), « Cas à surveiller » : imprimantes réglées à 5 s, signal Realtime coupé).

Source : docs.netlify.com, « How credits work », lue le 12.11.2026.

## Qui prévenir

| Qui | Quand |
|---|---|
| Jérémy | Toute panne qui dure plus de cinq minutes, et tout ce qui demande Netlify, Supabase ou le back-office |
| Claude (une session ouverte par Jérémy) | Après le service : comprendre, corriger, restaurer |
