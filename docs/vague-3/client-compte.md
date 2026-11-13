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

Le fichier « Télécharger mes données » du compte contient aussi les notes que l'équipe a écrites sur le client et sa marque (« à surveiller », « bloqué »). Une note écrite sur un client peut donc être lue par lui. À la suppression de son compte, ses notes sont effacées. La marque reste, pour qu'un blocage ne se lève pas en supprimant son compte : c'est une proposition qui attend la décision de Jérémy.

## E-mails aux clients

Chaque e-mail part en deux versions, texte seul et mise en page. La mise en page reste sur fond blanc, même quand le téléphone du client est en mode sombre. Sous le sujet, la boîte de réception montre la première phrase utile, par exemple « Nous avons bien reçu votre commande n° 37. ».
## Historique du compte

Le compte montre le nombre de commandes passées avec lui et les 30 dernières. « Voir les commandes plus anciennes » charge les 30 suivantes.
## Adresses enregistrées

Dans son compte, le client corrige les consignes d'une adresse : étage, nom sur la sonnette, code d'entrée et mot pour le livreur. Ce sont les mêmes champs qu'à l'accueil. La sonnette reste obligatoire.
