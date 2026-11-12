# Tablette du restaurant (lot 7a)

Adresse : `/tablette` (non indexée). Réservée au personnel, connexion distincte des comptes clients.

## Connexion du personnel

- E-mail et code à 6 chiffres, mêmes règles que les clients (`docs/comptes.md`) : usage unique, 10 minutes, 5 essais, limites par e-mail et par IP.
- Seules les adresses de la table `personnel` (actives) reçoivent un code. La page répond la même chose pour une adresse inconnue, sans envoyer de courriel.
- Session de 60 jours dans un cookie à part (`__Host-laferme-personnel`, HttpOnly, Secure, SameSite=Strict). Un membre désactivé perd l'accès tout de suite.
- Rôles : `service` (la tablette) et `gerant` (la tablette, puis le back-office au lot 7b).

Ajouter ou retirer quelqu'un, dans l'éditeur SQL de Supabase (en attendant le back-office) :

```sql
insert into personnel (email, nom, role) values ('prenom@exemple.ch', 'Prénom', 'service');
update personnel set actif = false where email = 'prenom@exemple.ch';
```

## Ce que fait la tablette

- « Démarrer le service » active le son et garde l'écran allumé. Sans ce geste, la page le dit.
- File des commandes à accepter, son répété toutes les 4 secondes et bandeau jaune pâle tant qu'une commande du jour attend.
- Accepter : heure proposée (celle du client, ou au plus tôt), réglable de 5 et 15 minutes. Le client reçoit un e-mail avec l'heure.
- Refuser avec un motif (trois motifs prêts ou un texte libre). Payée en ligne : remboursement total automatique, sinon e-mail « rien n'a été débité ». Un remboursement raté reste visible avec un bouton pour réessayer.
- Statuts en un appui : en préparation, prête au comptoir ou partie en livraison (e-mail au client), retirée ou livrée. Encaissée pour le comptoir. Changer l'heure (e-mail au client).
- Onglet « À l'avance » : commandes pour un autre jour.
- Réglages : pause des commandes en ligne (30 min, 1 h, jusqu'à reprise), livraison fermée, délai de préparation, plats épuisés pour la journée (ils reviennent seuls le lendemain).
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

## Risques assumés

- Le canal Realtime `tablette` est public : un tiers peut y envoyer des messages vides, qui font seulement relire la file. Aucune donnée n'y passe.
- Le membre de test `equipe@laferme.test` n'existe plus que dans la base embarquée (`supabase/local/donnees-test.sql`). La migration `20261112090000_correctifs_securite.sql` le retire de la vraie base avec ses sessions. Sur une préversion branchée sur la vraie base, la connexion du personnel attend Resend.
