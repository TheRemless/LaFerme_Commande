# Impression des tickets (lot 7c)

## Comment ça marche

- Un ticket par poste (pizza, cuisine) qui a des lignes, chacun avec ses seules lignes. L'acceptation sur la tablette les crée quand l'heure promise est proche. Pour une commande acceptée plus tôt (ce soir, un autre jour), la surveillance du serveur les crée à l'heure promise moins le réglage « Tickets des commandes à l'avance » (60 minutes proposées, back-office). Ils ne sortent qu'une fois (`premiers_tickets`, sous verrou de la commande), quel que soit le nombre de tours de surveillance ou de redémarrages. Le ticket indique l'heure réelle de l'acceptation. Une pause des commandes n'arrête pas ces tickets : la commande est acceptée, elle doit être préparée.
- Chaque ticket va à la première imprimante active de son poste. Sans imprimante pour ce poste, il s'affiche sur la tablette (bouton « Ticket »).
- Protocole Star CloudPRNT (HTTP) : l'imprimante interroge son adresse toutes les quelques secondes (POST), télécharge le ticket (GET) puis confirme (DELETE). Un ticket ne quitte la file qu'après confirmation. Il reste en file si l'imprimante est éteinte et sort à son retour.
- Le ticket est envoyé en image (PNG, 576 points de large, police DejaVu Sans Condensed) : grandes tailles, accents et « œ » sans dépendre de la page de codes de l'imprimante. Un texte de secours en ASCII existe si l'imprimante ne prend pas l'image.
- Format d'après la v1 §8 : poste et numéro en très grand, mode et heure en grand, client, adresse et compléments, lignes avec `SANS`, `+`, `CHOIX` et la note, ce qui sort à l'autre poste, paiement en clair. Pas de prix.
- Ticket renvoyé parce que l'imprimante n'a pas confirmé le précédent (2 minutes) : il commence par « RENVOI : CE TICKET EST PEUT-ÊTRE DÉJÀ SORTI ». « Réimprimer » ne double pas un ticket qui attend encore en file. Une commande annulée après acceptation : ses tickets en file sont retirés, « ANNULÉE » sort aux postes qui avaient déjà le leur. Une imprimante ajoutée ou réactivée reprend les tickets « sans imprimante » des commandes en cours.
- Tablette : état de chaque imprimante (en ligne, hors ligne depuis…, plus de papier, capot ouvert), état du ticket de chaque poste, « Réimprimer » (tout ou un poste), « Ticket » en grand en secours. Après trois échecs signalés par l'imprimante, le ticket passe en échec et reste réimprimable.

## Sécurité

- Une adresse par imprimante : `https://<site>/api/cloudprnt/<jeton>`. Le jeton (32 octets aléatoires) n'est montré qu'une fois dans le back-office (rubrique Imprimantes) ; seule son empreinte est en base.
- Au premier passage, l'imprimante est liée à son adresse MAC. Un autre appareil avec le même jeton est refusé. « Nouvelle adresse » coupe l'ancienne et délie l'appareil.
- Entre la création de l'adresse et le premier passage, n'importe quel appareil qui la connaît peut se lier à la place de l'imprimante (audit de sécurité, S13). D'où la règle de branchement : créer l'imprimante dans le back-office seulement quand elle est branchée et allumée, coller l'adresse tout de suite, puis vérifier qu'un ticket de test sort bien de cette imprimante. Si la tablette la dit « en ligne » mais que rien ne sort, « Nouvelle adresse » et recommencer.
- Une imprimante ne peut lire et confirmer que ses propres tickets.

## Surveillance

Chaque minute en production (fonction planifiée Netlify `netlify/functions/surveillance.mts`). Les passages des imprimantes et les relectures de la tablette la relancent aussi, une fois par minute au plus, ce qui la fait tourner sur les préversions :

- pendant les heures d'un service seulement, une commande du jour pas acceptée après le délai réglé (5 minutes par défaut, back-office, compté depuis le paiement en ligne ou la création au comptoir) : un e-mail au restaurant (`ALERTE_EMAIL`), une seule fois par commande. La tablette affiche « Attend depuis N min » ;
- les commandes acceptées à l'avance dont l'heure d'impression est arrivée : leurs tickets, à toute heure. Une création ratée (base lente) est retentée au tour suivant. Sur une préversion, c'est le passage de l'imprimante elle-même qui lance ce tour : la tablette n'est pas nécessaire ;
- la tablette muette depuis 3 minutes pendant un service : commandes en ligne mises en pause, e-mail au restaurant, bandeau sur la tablette. La reprise se fait à la main (« Reprendre les commandes »). Une pause en cours (datée ou sans fin) n'est pas remplacée ; une pause datée finie ne bloque plus rien. Le signe de vie ne vient que d'un appareil qui a démarré le service.

## Imprimante à acheter

**Star Micronics mC-Print3, référence MCP31CI BK** (noir, USB et Ethernet, massicot). Dès CHF 257.38 hors port sur Toppreise.ch, relevé du 3.11.2026 (`docs/recherche/imprimantes_routage.md`). Prendre la version Ethernet, pas la Wi-Fi (MCP31CBI).

- Elle prend CloudPRNT en standard, imprime les images PNG telles quelles et c'est le protocole que le site parle aujourd'hui.
- Epson Server Direct Print (TM-m30III) n'est pas branché : sa documentation officielle n'a pas pu être lue (page en 403, PDF illisible). L'interface est prête pour l'ajouter, mais sans spécification vérifiée, mieux vaut ne pas acheter d'Epson pour l'instant.
- La v1 conseille d'acheter une seule imprimante d'abord pour le test, puis la deuxième.
- À prévoir : rouleaux de papier thermique 80 mm, un câble Ethernet vers le routeur ou le switch.

## Réglages à faire sur l'imprimante

1. Brancher l'imprimante en Ethernet au switch (storekit et Star recommandent le câble plutôt que le Wi-Fi pour l'impression cloud).
2. Mettre le micrologiciel à jour (version 3.2 au moins pour les jetons de tâche, 3.5 ou plus récente conseillée).
3. Ouvrir la page de réglages de l'imprimante (son adresse IP dans un navigateur), rubrique CloudPRNT :
   - activer CloudPRNT, protocole HTTP (pas MQTT) ;
   - « Server URL » : l'adresse copiée dans le back-office, rubrique Imprimantes (`https://…/api/cloudprnt/…`) ;
   - intervalle d'interrogation : 10 secondes (5 en usine). Un ticket sort au plus 10 secondes après l'acceptation. La consommation de crédits Netlify des imprimantes est divisée par deux (`docs/performance.md`) ;
   - pas d'identifiant ni de mot de passe : le jeton de l'adresse suffit.
4. Le certificat HTTPS du site (Netlify) est signé par une autorité courante : rien à installer.
5. Sur la tablette, l'imprimante doit passer « en ligne » dans la minute. Accepter une commande de test : le ticket sort.

## Coût en requêtes

Une imprimante qui interroge toutes les 10 secondes, jour et nuit, fait environ 8 600 requêtes par jour, chacune avec un seul appel à la base. Estimation en crédits Netlify sur un mois et cas à surveiller : `docs/performance.md`, « Crédits Netlify sur un mois ».

## Variables à créer (Netlify)

- `ALERTE_EMAIL` : l'adresse du restaurant qui reçoit les alertes (en plus de Resend, voir `docs/comptes.md`).
