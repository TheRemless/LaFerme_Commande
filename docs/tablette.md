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
- Mise à jour : vérification toutes les 5 secondes, et tout de suite au signal Supabase Realtime (message vide sur le canal `tablette`, aucune donnée). Perte de connexion : bandeau avec l'heure du dernier contact.
- Chaque changement de statut est tracé dans `evenements_commande` avec son auteur (`tablette:Prénom`).

## Pas encore fait

- Impression à l'acceptation (lot 7c).
- Surveillance de la tablette par le serveur (pause automatique sans signe de vie) : avec l'impression, au lot 7c.
- Alerte si une commande n'est pas acceptée après un délai.

## Risques assumés

- Le canal Realtime `tablette` est public : un tiers peut y envoyer des messages vides, qui font seulement relire la file. Aucune donnée n'y passe.
- Le membre de test `equipe@laferme.test` est dans la base de production pour les préversions. À retirer avant la mise en ligne (liste du lot 8).
