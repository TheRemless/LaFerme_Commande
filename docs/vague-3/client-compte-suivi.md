# Suivi de commande et reçu, ce que le client lit

Pour l'équipe qui répond au téléphone. Tenu par la session `client-compte` (vague 3).

## Ce que le client lit sur sa page de suivi

- Une commande « dès que possible » pas encore acceptée 10 minutes après le paiement, pendant le service : « Le restaurant n'a pas encore confirmé votre commande. Il est prévenu. », avec le numéro.
- 10 minutes après l'heure confirmée, si la commande n'est pas livrée (ou pas prête à emporter) : « Nous avons du retard sur l'heure prévue. », avec le numéro.
- Une commande refusée : « Commande annulée par le restaurant », jamais « refusée ». Annulée à sa demande : « Vous avez annulé la commande. »
- Chaque remboursement, avec son état (remboursé, en cours, pas abouti) et les délais habituels : quelques minutes avec TWINT, de 5 à 10 jours ouvrables avec une carte.

## Reçu avec TVA

Le lien « Reçu avec TVA » est en bas de la page de suivi d'une commande payée. Il est aussi dans le compte du client (« Reçu »). Le reçu donne le restaurant, le numéro de TVA, la date, les plats, les frais, le total, le taux et le montant de la TVA. Le client l'imprime ou l'enregistre en PDF depuis son navigateur. Il ne porte ni le nom de famille ni l'adresse du client.

## Annuler sa commande depuis le suivi

Désactivé tant que Jérémy ne l'a pas décidé (réglage `annulation_client_active`). Activé, le bouton « Annuler ma commande » apparaît tant que la commande n'est pas acceptée, avec une confirmation. Le suivi dit ensuite « Vous avez annulé la commande. ».
