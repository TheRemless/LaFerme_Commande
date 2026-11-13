# Espace client, suivi et e-mails aux clients

Ce que le client voit après sa commande, pour l'équipe qui répond au téléphone. Tenu par la session `client-compte` (vague 3).

## Il ne retrouve pas ses anciennes commandes

Il se connecte sur le site, en haut à droite, avec l'e-mail donné à la commande. Les commandes passées sans compte avec cet e-mail, payées et de moins de 12 mois, s'y rangent toutes seules.

Une commande d'un compte qu'il a supprimé n'y revient pas.

Rien d'autre n'est recopié dans son compte : ni téléphone, ni adresse, ni code d'entrée. Il les tape à sa prochaine commande. C'est voulu : une commande passée avec une adresse e-mail mal tapée ne doit pas donner les coordonnées d'un inconnu.

## Ce que le client lit sur sa page de suivi

- Une commande « dès que possible » pas encore acceptée 10 minutes après le paiement, pendant le service : « Le restaurant n'a pas encore confirmé votre commande. Il est prévenu. », avec le numéro.
- 10 minutes après l'heure confirmée, si la commande n'est pas livrée (ou pas prête à emporter) : « Nous avons du retard sur l'heure prévue. », avec le numéro.
- Une commande refusée : « Commande annulée par le restaurant », jamais « refusée ». Annulée à sa demande : « Vous avez annulé la commande. »
- Chaque remboursement, avec son état (remboursé, en cours, pas abouti) et les délais habituels : quelques minutes avec TWINT, de 5 à 10 jours ouvrables avec une carte.

## Reçu avec TVA

Le lien « Reçu avec TVA » est en bas de la page de suivi d'une commande payée. Il est aussi dans le compte du client (« Reçu »). Le reçu donne le restaurant, le numéro de TVA, la date, les plats, les frais, le total, le taux et le montant de la TVA. Le client l'imprime ou l'enregistre en PDF depuis son navigateur. Il ne porte ni le nom de famille ni l'adresse du client.

## Annuler sa commande depuis le suivi

Désactivé tant que Jérémy ne l'a pas décidé (réglage `annulation_client_active`). Activé, le bouton « Annuler ma commande » apparaît tant que la commande n'est pas acceptée, avec une confirmation. Le suivi dit ensuite « Vous avez annulé la commande. ».
## Ses données (nLPD)

Le fichier « Télécharger mes données » du compte contient aussi les notes que l'équipe a écrites sur le client et sa marque (« à surveiller », « bloqué »). Une note écrite sur un client peut donc être lue par lui. À la suppression de son compte, ses notes et sa marque sont effacées (décision de Jérémy, 13.11.2026).

## E-mails aux clients

Chaque e-mail part en deux versions, texte seul et mise en page. La mise en page reste sur fond blanc, même quand le téléphone du client est en mode sombre. Sous le sujet, la boîte de réception montre la première phrase utile, par exemple « Nous avons bien reçu votre commande n° 37. ».

Un seul e-mail à la commande (décision de Jérémy du 13.11.2026) : le récapitulatif, le reçu avec TVA quand la commande est payée en ligne et le lien de suivi. L'heure confirmée, « prête » et « en route » se lisent sur la page de suivi. Le client reçoit encore un e-mail quand quelque chose change pour lui : commande refusée, nouvelle heure, remboursement, plat manquant, commande modifiée par l'équipe, commande non remise. Pour revenir aux e-mails « acceptée », « prête » et « en route », mettre `COURRIELS_ETAPES=1` dans Netlify.

## Historique du compte

Le compte montre le nombre de commandes passées avec lui et les 30 dernières. « Voir les commandes plus anciennes » charge les 30 suivantes.

## Un problème avec la commande

Sur la page de suivi d'une commande acceptée, pendant 14 jours, le client touche « Signaler un problème ». Il choisit ce qui ne va pas (retard, plat manquant, froid, erreur, qualité, livraison, autre) et l'écrit en quelques mots. Le restaurant reçoit une alerte. Le dossier est dans le back-office, rubrique Réclamations. Trois messages au plus par commande. Ensuite, le client doit appeler.

## Adresses enregistrées

Dans son compte, le client corrige les consignes d'une adresse : étage, nom sur la sonnette, code d'entrée et mot pour le livreur. Ce sont les mêmes champs qu'à l'accueil. La sonnette reste obligatoire.

## Appareils connectés

La rubrique « Connexion » du compte liste les appareils connectés, avec un nom court tiré du navigateur (« Safari sur iPhone ») et la date de connexion. Le client peut en déconnecter un seul, par exemple un téléphone perdu, ou tous à la fois.

## Heure et allergie au suivi

Le suivi et les e-mails donnent l'heure confirmée en fourchette, comme l'accueil (« Prête entre 19h35 et 19h45 »), selon les largeurs réglées par le restaurant. À largeur 0, une seule heure (« vers 19h40 »). L'allergie que le client a signalée à la commande est rappelée dans le détail de sa page de suivi. L'e-mail de confirmation dit seulement qu'une allergie est signalée, sans en recopier le texte.

## Envoi d'essai réel des e-mails

Jérémy a accepté le 13.11.2026 de recevoir un essai réel de tous les e-mails à son adresse privée. L'essai part de son Mac, quand le chef le dit. Il n'a pas besoin d'une préversion Netlify et n'écrit rien dans la vraie base. Les plats et les prix viennent de la base embarquée et la commande est fictive (n° 37).

1. Dans le Terminal, aller dans le dossier du projet à jour de `main`, puis lancer `npm ci`.
2. Taper les réglages de la boîte du restaurant (voir `docs/comptes.md`). Le mot de passe ne s'affiche pas et ne reste pas dans l'historique :

   ```bash
   read "SMTP_UTILISATEUR?Identifiant SMTP : "; export SMTP_UTILISATEUR
   read -s "SMTP_MOT_DE_PASSE?Mot de passe SMTP : "; echo; export SMTP_MOT_DE_PASSE
   read "COURRIEL_EXPEDITEUR?Expéditeur (La Ferme <adresse>) : "; export COURRIEL_EXPEDITEUR
   ```

3. Essai à blanc, sans envoi. L'adresse publique du site sert au logo :

   ```bash
   npm run courriels:essai -- <adresse privée> --origine=https://<adresse du site> --etapes
   ```

4. Même commande avec `--envoyer` à la fin. 15 e-mails partent, un toutes les 2 secondes, chacun avec un sujet qui commence par « [Essai n/15] ». Ils prennent 15 places sur le quota du jour d'Infomaniak. `--etapes` ajoute « acceptée », « prête » et « en route », qui ne partent plus par défaut.
5. Fermer le Terminal : les réglages tapés disparaissent avec lui.

À regarder dans la boîte de réception :

- les e-mails arrivent dans la boîte principale et pas dans les indésirables (sinon DMARC et DKIM du domaine, toujours à régler) ;
- le logo, les accents et les montants sont justes ;
- la lecture tient en mode sombre et sur le téléphone ;
- le bouton « Suivre la commande » mène à « commande introuvable », comme prévu pour une commande fictive.

Le script refuse de tourner si une variable mène à une vraie base (Supabase, Postgres ou Netlify).

## Allergie effacée après 30 jours

L'allergie ou l'intolérance signalée à la commande est effacée 30 jours après la commande (décision de Jérémy du 13.11.2026). Elle disparaît de la commande et des tickets de cuisine gardés pour la réimpression. Le reste du ticket ne change pas. La surveillance du site s'en charge à chaque tour (migration `20261214090000_allergie_30_jours.sql`). L'effacement ne date pas la commande : une commande terminée il y a un mois ne revient pas dans la journée de la tablette. La déclaration de confidentialité le dit, ainsi que les 30 jours au plus des copies de sauvegarde chiffrées.
