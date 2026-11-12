# Tablette du restaurant (lot 7a)

Adresse : `/tablette` (non indexée). Réservée au personnel, connexion distincte des comptes clients.

## Connexion du personnel

- E-mail et code à 8 chiffres (6 pour les clients), sinon mêmes règles que les clients (`docs/comptes.md`) : usage unique, 10 minutes, 5 essais, limites par e-mail et par IP, 15 codes faux par jour et par adresse.
- Seules les adresses de la table `personnel` (actives) reçoivent un code. La page répond la même chose pour une adresse inconnue, sans envoyer de courriel, et après la même durée (1,5 seconde au moins, audit de sécurité S11). À la vérification, le délai entre deux codes faux (1, 2, 4 puis 8 secondes) s'applique aussi sans code en base, pour que la réponse ne dise pas si l'adresse est de l'équipe.
- Au 15e code faux en 24 heures sur une adresse de l'équipe, la connexion par code est bloquée jusqu'au lendemain à la même heure. Le membre et le restaurant (`ALERTE_EMAIL`) reçoivent un courriel, une seule fois. Les appareils déjà connectés le restent.
- Session de 60 jours dans un cookie à part (`__Host-laferme-personnel`, HttpOnly, Secure, SameSite=Strict). Un membre désactivé perd l'accès tout de suite.
- Rôles : `service` (la tablette), `gerant` (la tablette, puis le back-office au lot 7b) et `livreur` (seulement ses livraisons, page `/livreur`, voir `docs/livreurs.md`). Un livreur n'ouvre ni la tablette ni le back-office.

Ajouter, retirer ou changer l'accès de quelqu'un : back-office, rubrique « Équipe » (depuis le 14.11.2026). Seul le tout premier gérant se crée dans l'éditeur SQL de Supabase, une fois :

```sql
insert into personnel (email, nom, role) values ('prenom@exemple.ch', 'Prénom', 'gerant');
```

## Ce que fait la tablette

- « Démarrer le service » active le son et garde l'écran allumé. Sans ce geste, la page le dit.
- File des commandes à accepter, son répété toutes les 4 secondes et bandeau jaune pâle tant qu'une commande du jour attend.
- Accepter : heure proposée (celle du client, ou au plus tôt), réglable de 5 et 15 minutes. Le client reçoit un e-mail avec l'heure.
- Refuser avec un motif (trois motifs prêts ou un texte libre). Payée en ligne : remboursement total automatique, sinon e-mail « rien n'a été débité ». Un remboursement raté reste visible avec un bouton pour réessayer.
- Statuts en un appui : en préparation, prête au comptoir ou partie en livraison (e-mail au client), retirée ou livrée. Encaissée pour le comptoir. Changer l'heure (e-mail au client).
- Onglet « À l'avance » : commandes à accepter pour un autre jour, et commandes acceptées pour plus tard dont les tickets ne sont pas encore sortis (« Tickets prévus le vendredi 13 novembre à 18h30 », bouton « Imprimer maintenant »). À l'heure d'impression, elles passent dans « En cours ». Le jour s'affiche à côté de l'heure promise dès qu'il n'est pas aujourd'hui.
- Réglages : pause des commandes en ligne (30 min, 1 h, jusqu'à reprise), livraison fermée, retard du soir, plats épuisés pour la journée (ils reviennent seuls le lendemain).
- Mise à jour : relecture toutes les 15 secondes pendant le service, toutes les 60 secondes hors service (toutes les 5 secondes si le signal ne passe pas). Le signal Supabase Realtime (message vide sur le canal `tablette`, aucune donnée) déclenche une relecture immédiate. Perte de connexion : bandeau avec l'heure du dernier contact.
- Chaque changement de statut est tracé dans `evenements_commande` avec son auteur (`tablette:Prénom`).

## Correctifs du 13.11.2026 (audit « samedi soir »)

Détail : `docs/audits/samedi-soir.md`, « Suivi des corrections ».

- Chaque geste envoie l'état que la tablette affichait. Si une autre tablette a changé la commande entre-temps, rien ne se fait et l'écran le dit.
- Annuler une commande acceptée retire ses tickets de la file et imprime « ANNULÉE, NE PAS PRÉPARER » aux postes qui avaient déjà le leur.
- Refus d'une commande payée quand le remboursement échoue : le client reçoit « refusée, remboursement en cours », le restaurant une alerte, la tablette un bandeau. La commande reste dans « Terminées » avec « Rembourser » jusqu'au remboursement, même les jours suivants.
- Une commande payée pendant une pause, après une rupture ou trop tard pour son heure arrive avec un avertissement jaune.
- Retrait payé au comptoir : « Retirée et payée » d'un seul geste. Une commande retirée sans être encaissée garde « Encaissée » dans « Terminées ».
- Seul un appareil qui a touché « Démarrer le service » (ou « Continuer sans son ») donne le signe de vie surveillé par le serveur. Le son est relancé au retour de veille.
- Une commande acceptée sans ticket affiche « Ticket non créé » et « Réimprimer ».
- Numéros : une commande à l'avance prend un numéro du jour où elle est servie.

## Commandes à l'avance (SS-11, G08, 13.11.2026)

- Accepter une commande pour ce soir ou un autre jour confirme l'heure au client tout de suite (e-mail), sans imprimer. La tablette répond « Acceptée. Tickets prévus … ».
- Les tickets sortent avant l'heure promise, selon le mode : 60 minutes pour une livraison (50 minutes de délai maximal en zone 2, plus 10 de marge), 30 minutes pour un retrait (20 minutes de préparation, plus 10). Valeurs validées par Jérémy le 12.11.2026, réglables dans le back-office. La surveillance du serveur les crée, même tablette éteinte et même pendant une pause.
- Heure changée avant l'impression : le ticket sort à la nouvelle heure moins le réglage, avec la nouvelle heure. Annulée avant l'impression : aucun ticket, ni normal ni « ANNULÉE ».
- « Imprimer maintenant » sort les tickets tout de suite ; la surveillance ne les refait pas ensuite.

## Risques assumés

- Le canal Realtime `tablette` est public : un tiers peut y envoyer des messages vides, qui font seulement relire la file. Aucune donnée n'y passe.
- Le membre de test `equipe@laferme.test` n'existe plus que dans la base embarquée (`supabase/local/donnees-test.sql`). La migration `20261112090000_correctifs_securite.sql` le retire de la vraie base avec ses sessions. Sur une préversion branchée sur la vraie base, la connexion du personnel attend le serveur d'envoi.

## Correctifs du 14.11.2026 (audit « journée du gérant »)

Détail : `docs/audits/gerant.md`, « Suivi des corrections ».

- « Retard ce soir » (0 à 90 minutes) remplace le délai de préparation sur la tablette : il s'ajoute à l'heure annoncée pour le retrait et à chaque zone de livraison. Le délai habituel se règle au back-office.
- Chaque nuit à 5h (heure de Genève), le premier tour de surveillance remet à zéro le retard, rouvre la livraison et lève une « Pause jusqu'à reprise ». Une pause automatique (tablette muette) reste : il faut la lever en regardant la tablette.
- Annuler à la demande du client : motif « À la demande du client », bouton « Annuler et rembourser ». Le client lit « Votre commande est annulée, comme vous nous l'avez demandé ». Le lien qui ferme le panneau s'appelle « Fermer ».

## Vague 2 (16.11.2026, audit du gérant)

- Suppléments épuisés pour la journée, comme les plats (`options.rupture_jour`, colonne `rupture` en fin de la vue `options_publiques`). Le panier refuse un supplément épuisé, la fiche plat le grise.
- « Il manque… » sur une commande acceptée : on coche le plat (et combien) ou le supplément qui manque, la base calcule le montant (prix de la ligne, prix actuel du supplément), puis on confirme. Payée en ligne : remboursement Stripe partiel, clé du geste comme clé d'idempotence. Au comptoir pas encore payé : déduit de ce qu'il reste à encaisser. Le client reçoit un e-mail. Tout membre actif peut le faire tant que la commande est acceptée ou en préparation (même limite que l'annulation) ; une fois prête ou partie, le gérant seulement. Le remboursement libre reste au gérant.
- « Déconnexion » demande une confirmation (G16). « Attend depuis » ne s'affiche plus sur une commande pour un autre jour (G19).

## Livreurs (vague 2)

Onglet « Livraisons » : donner une livraison acceptée à un livreur, ordre de passage proposé ou à la main, réattribuer, reprendre, problème signalé par le livreur (bandeau jaune). Une livraison partie peut désormais être annulée depuis « En cours ». Détail : `docs/livreurs.md`.
