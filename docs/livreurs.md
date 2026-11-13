# Livreurs (vague 2, 12.11.2026)

Le restaurant livre avec ses propres livreurs salariés. La tablette leur donne les commandes et range leur tournée. Chaque livreur voit ses livraisons sur son téléphone, page `/livreur`. Mode d'emploi : `docs/mode-emploi.md`, page 3.

## Ce qui est construit

| Partie | Où | Ce que ça fait |
|---|---|---|
| Rôle « livreur » | back-office, « Équipe » | Même connexion par code e-mail que l'équipe. Un livreur n'ouvre ni `/tablette` ni `/gestion` ni leurs routes (403). La tablette n'ouvre pas `/api/livreur` |
| Onglet « Livraisons » | tablette | Commandes acceptées sans livreur, tournée de chaque livreur, ordre proposé ou à la main, réattribution, reprise, problème signalé, livreur connecté ou non |
| Page `/livreur` | téléphone | Livraisons en cours dans l'ordre, heure promise, adresse, étage, sonnette, code, consigne, appel du client, contenu résumé, paiement, itinéraire. Gestes « Je pars », « Livrée », « Problème » |
| Annulation d'une commande partie | tablette, « En cours » | « Annuler la commande » reste possible une fois partie (adresse introuvable, autre), par le gérant seulement (audit de sécurité 2, S2-01). Remboursée comme toute annulation (fonction `annuler_commande_partie`). Le livreur lit « annulée, rapportez le sac » |
| Client absent | tablette, « Livraisons » | Décision de Jérémy (12.11.2026) : pas de remboursement automatique. « Client absent : clore » termine la commande avec le motif « Client absent à la livraison. », e-mail factuel au client (« non remise »), alerte au gérant qui décide dans le back-office (remboursement total, partiel ou aucun). Le suivi du client affiche « Commande non remise ». Le livreur lit « close, client absent, rapportez le sac » |

Une tournée n'est pas une table : ce sont les livraisons en cours d'un livreur, rangées par position. Pas de « tournée fermée » à gérer : une commande livrée sort de la liste, une nouvelle s'ajoute à la fin puis l'ordre est recalculé (sauf ordre fait à la main).

## Ordre de passage proposé

Sans service payant ni coordonnées (`src/lib/tournee.ts`). Départ du restaurant à Onex. À chaque étape, la livraison la plus proche de la précédente : même rue, puis même NPA, puis même zone. Chaque cran d'éloignement vaut 15 minutes d'heure promise : on ne fait pas attendre une heure promise nettement plus tôt pour rester dans la rue. Les livraisons déjà parties restent devant.

Limite assumée : deux rues voisines de NPA différents comptent comme éloignées. Si l'ordre ne convient pas, « Plus tôt » et « Plus tard » le changent et il n'est plus recalculé.

## Gestes sans doublon (réseau coupé)

Chaque geste part avec une clé tirée au hasard par le téléphone. Sans réseau, il attend dans le stockage du téléphone (clé, numéro de commande, geste, motif et mot du livreur, jamais l'adresse) et repart seul au retour du signal, toutes les 5 secondes et dès que le téléphone revient en ligne. Le serveur garde chaque clé (`gestes_livreur`) : un geste reçu deux fois rend la même réponse sans rien refaire. Le client ne reçoit qu'un e-mail « en route ».

## Données personnelles

- Le livreur ne voit que ses livraisons en cours : commande acceptée, en préparation ou partie, attribuée à lui. Livrée, réattribuée, reprise ou annulée : l'adresse disparaît. Il garde seulement « N° 12 annulée » ou « donnée à un autre livreur » jusqu'à « Compris ».
- Sur le téléphone : prénom et téléphone du client, adresse, étage, sonnette, code, consigne. Pas de nom de famille, pas d'e-mail, pas de plats ni de prix.
- Rien n'est mis en cache (`Cache-Control: no-store, private`). Les adresses restent en mémoire de la page, jamais dans le stockage du téléphone.
- Journal `journal_livraisons` : attribution, réattribution, reprise, ordre, chaque geste ainsi que la première fois qu'une adresse s'affiche sur le téléphone d'un livreur (« vue »). Les changements de statut restent aussi dans `evenements_commande` avec l'auteur `livreur:Prénom`.
- Le lien « Itinéraire » transmet l'adresse seule (rue, numéro, NPA, localité) à l'appli de navigation du téléphone : Plans sur iPhone, `geo:` sur Android (l'appli choisie par le livreur), Google Maps ailleurs.
- La tablette voit l'heure de la dernière mise à jour de la page `/livreur` de chaque livreur (`activite_livreurs`), pas sa position.

## Risques assumés

- Session de 12 heures sur le téléphone du livreur (une soirée), 60 jours pour la tablette et le back-office (audit de sécurité 2, S2-15). Téléphone perdu ou volé : « Déconnecter partout » dans « Équipe ». Le voleur ne verrait que les livraisons en cours du moment.
- Pendant une coupure, une livraison déjà livrée reste affichée en grisé avec « envoi en attente » tant que le geste n'est pas parti.
- Un livreur peut faire une capture d'écran. Le mode d'emploi le lui interdit, la technique ne peut pas l'empêcher.

## Option non construite : position du livreur en continu

Demandé hors périmètre. Ce que ça impliquerait si Jérémy le veut un jour :

| Point | Conséquence |
|---|---|
| Technique | Le navigateur ne donne la position que page ouverte et écran allumé. iPhone coupe tout en arrière-plan : pour un suivi fiable il faut une appli installée. |
| Client | Il pourrait voir le livreur approcher sur sa page de suivi. |
| Droit du travail et nLPD (non vérifié, à faire valider) | Position d'un salarié = donnée personnelle. La surveillance du comportement des travailleurs est encadrée en Suisse : information écrite des livreurs, but limité à la livraison en cours, pas de contrôle des personnes, conservation courte (effacement à la livraison), registre des traitements. |
| Coût | Aucun service payant en version page web. Une appli installée demande un développement à part. |

Sans décision écrite de Jérémy, rien n'est fait.


Planning et suivi des livreurs au back-office (vague 3) : `docs/planning-livreurs.md`.
