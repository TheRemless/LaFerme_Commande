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

## Position du livreur au suivi

Pendant que sa commande est en route, le client voit la position du livreur sur une carte grise de swisstopo, sous les étapes de son suivi (décision de Jérémy du 13.11.2026). La carte ne montre que le livreur, pas l'adresse du client. Elle se met à jour avec le suivi toutes les 20 secondes. Une ligne donne l'heure du relevé (« Position relevée à 19h42. »). Quand la position n'est pas montrable, rien n'est dit : une phrase apprendrait au client qu'un autre arrêt passe avant le sien.

La base de `tablette` décide qui voit quoi (PR #228) : seulement le client de l'arrêt en cours, jamais le client suivant de la même tournée. La position montrée a moins de 2 minutes. Le client suivant ne voit son livreur qu'à 400 m du point de masquage. Ce point est la porte précédente, ou le restaurant si l'arrêt d'avant s'est terminé pendant que sa commande y attendait encore. Il n'y a donc pas de carte pendant les premières minutes du trajet. Aucun texte du suivi ne promet de suivre le livreur dès son départ. L'absence de carte ne se signale pas. À la remise, la carte disparaît. Quand le livreur passe sur son appli de navigation, son téléphone n'envoie plus sa position et la carte disparaît au bout de 2 minutes. La déclaration de confidentialité le dit.

## Cagnotte des clients

Programme validé par Jérémy le 15.11.2026. Construit éteint (interrupteur « Cagnotte des clients » dans Réglages généraux) : la session principale l'allume en vraie base après la fusion. La migration est `20261216090000_cagnotte.sql`.

Ce que le client voit :

- dans son compte, « Vous avez CHF 7.40 dans votre cagnotte », la date limite, le rappel par e-mail (coché par défaut) et l'historique ;
- au paiement en ligne, « Utiliser ma cagnotte » dès CHF 10, en tout ou en partie ;
- sur le suivi, le reçu et l'e-mail de confirmation, une ligne « Cagnotte utilisée ».

Les règles sont toutes en base :

- gain de 5 % du prix des plats (hors frais de livraison, après code promo et cagnotte utilisée, au centime inférieur), crédité seulement quand la commande est livrée ou retirée ;
- rien pour une commande refusée, annulée, remboursée ou close « client absent » ; un remboursement partiel retire la part correspondante, au plus ce qui reste ;
- utilisation sous verrou du compte, dans la transaction qui crée la commande : deux onglets ne dépensent pas deux fois le même solde. CHF 0.50 restent à payer en ligne (minimum de Stripe). Jamais au comptoir ni au téléphone ;
- la cagnotte utilisée revient si le paiement échoue, si la commande est refusée ou annulée. Un remboursement après coup (plats retirés au téléphone, geste) ne rend que l'argent payé. Une commande passée « remboursée » ne rend donc pas la cagnotte (revue de sécurité). Le gérant peut la recréditer à la main, avec un motif ;
- une commande à payer au comptoir ne rapporte qu'une fois encaissée. Un gain qui n'a pas pu être retiré faute de solde, parce que le client avait déjà tout dépensé, est retenu dès qu'un montant revient au compte. Le remboursement d'un complément payé par lien ne réduit pas le gain (relectures de qualite et bo-pilotage) ;
- tout le solde expire 12 mois après la dernière commande (règle de Jérémy, pas d'expiration par lot), jamais pendant une commande en cours. Le rappel part 30 jours avant, au premier tour de la surveillance de chaque jour de service.

Au back-office, la rubrique Cagnotte sous les Réglages généraux règle le taux (3 à 10 %), le seuil et les soirs doublés (jour de la semaine ou date, commandes promises dès 15h). Elle affiche aussi le montant dû aux clients pour la fiduciaire. La fiche d'un client avec compte a un onglet Cagnotte : solde, historique, ajustement par le gérant (CHF 100 au plus, motif obligatoire, journalisé).

Compta : la cagnotte utilisée est une réduction de prix. Total et TVA de la commande sont déjà nets. La clôture et l'export Crésus n'ont donc pas changé.

## Parrainage

Sous le même interrupteur que la cagnotte (migration `20261216100000_parrainage.sql`). Dans son compte, le client trouve son lien personnel `/parrain/<code>`. Le code compte 8 caractères, l'adresse ne porte aucune donnée du client. Le lien pose un cookie de 30 jours, puis mène à l'accueil. Le compte créé ensuite est rattaché à la connexion par code.

La base refuse un compte de plus de 24 heures, un e-mail qui a déjà commandé, un deuxième parrain, l'auto-parrainage et plus de 10 parrainages par mois (réglable). À la première commande livrée ou retirée du filleul, elle revérifie le téléphone et l'adresse de livraison. S'ils sont ceux du parrain ou ont servi à un autre client, le parrainage est refusé sans crédit. Sinon, chacun reçoit CHF 10 (réglable) dans sa cagnotte. L'export du compte donne le code, le nombre de proches parrainés et l'état du parrainage reçu, jamais le nom de l'autre personne.

Durcissements après la revue de sécurité :

- les téléphones se comparent sur leurs 9 derniers chiffres, celui de la personne qui reçoit compris ;
- les boîtes Gmail se comparent sans points ni « +étiquette » ;
- un compte qui a déjà commandé n'est pas rattaché ;
- le crédit n'a lieu qu'à la première commande remise, payée sans remboursement. Il est repris si cette commande est remboursée en entier ;
- un lien suivi ne remplace pas un parrain déjà retenu.

Parrainage sûr (relecture de qualite, migration `20261216190000_parrainage_sur.sql`) :

- le parrainage a son propre interrupteur, « Parrainage », éteint : la cagnotte peut s'allumer sans lui ;
- la commande qui déclenche le crédit doit atteindre un minimum de plats nets (CHF 30, validé par Jérémy le 19.11.2026, réglable au back-office). En dessous, le parrainage attend la commande suivante ;
- un lien ne vaut que si son titulaire a lui-même une commande remise, payée et au minimum. Un faux compte qui n'a commandé qu'une eau ne recrute personne. La chaîne de faux filleuls est cassée ;
- une reprise manquée faute de solde est retenue dès qu'un montant revient au compte ;
- un remboursement partiel qui fait passer la commande qui a déclenché le crédit sous le minimum reprend les deux crédits (relecture #262, migration `20261216200000_parrainage_remboursement.sql`) ;
- l'ajustement du gérant affiche le solde réel et la part retenue.

L'empreinte du moyen de paiement n'est pas utilisée. Stripe n'en documente pas pour TWINT, elle est notée pour plus tard.

Jérémy a décidé le 19.11.2026 de ne pas vérifier le téléphone par SMS. À emporter, une personne décidée peut encore se parrainer elle-même avec une nouvelle boîte e-mail et un autre numéro. Le minimum de CHF 30, le plafond de 10 par mois et les alertes au gérant limitent la perte.

### Alertes d'abus et suspension

Migration `20261217090000_alertes_parrainage.sql`. La surveillance cherche à chaque tour les cas suivants :

- un parrain qui a plus de 3 filleuls crédités en 30 jours (réglable) ;
- des filleuls d'un même parrain qui partagent une adresse de livraison, une adresse IP de connexion ou un même nom ;
- un parrain dont les filleuls ne recommandent pas. L'alerte part dès 3 filleuls crédités depuis plus de 30 jours, si 75 % d'entre eux n'ont pas de deuxième commande. Ces deux seuils sont des propositions, réglables ;
- un compte qui a reçu plus en parrainage qu'il n'a payé sur 30 jours.

Chaque cas part une seule fois, par le circuit des autres alertes (type « Parrainage à surveiller », réglable dans les alertes). Les cas d'un même tour partent dans un seul e-mail. Il ne donne que le type de signal et renvoie au back-office, sans nom ni adresse du client. L'alerte gardée en base ne contient que des nombres. L'accueil du back-office montre les signaux ouverts. Les signaux « trop de filleuls », « sans suite » et « reçu plus que payé » peuvent revenir le mois suivant, jamais deux fois dans le même mois.

L'adresse IP est celle déjà notée à la connexion au compte (`journal_connexions.ip_court`, 8 caractères, déclarée dans la confidentialité). Rien de nouveau n'est gardé. L'appareil n'est pas comparé. Le journal ne garde qu'un libellé générique (« Safari sur iPhone »), partagé par trop de clients.

La rubrique « Parrainages » du back-office est réservée au gérant. Elle montre pour chaque parrain ses filleuls (date, statut, montant crédité) et ses signaux, que le gérant peut classer. « Suspendre ce parrain » demande un motif de 3 à 200 caractères et passe au journal. La suspension bloque les nouveaux liens et les crédits en attente. Les crédits déjà versés restent. « Réactiver ce parrain » rouvre les nouveaux liens.

Captures dans `docs/rendus/vague-3/client-compte/` (`parrainages-bureau.png` et `parrainages-390.png`).
