# Impression des tickets (lot 7c)

## Comment ça marche

- L'acceptation sur la tablette, et elle seule, crée les tickets : un par poste (pizza, cuisine) qui a des lignes, chacun avec ses seules lignes.
- Chaque ticket va à la première imprimante active de son poste. Sans imprimante pour ce poste, il s'affiche sur la tablette (bouton « Ticket »).
- Protocole Star CloudPRNT (HTTP) : l'imprimante interroge son adresse toutes les quelques secondes (POST), télécharge le ticket (GET) puis confirme (DELETE). Un ticket ne quitte la file qu'après confirmation. Il reste en file si l'imprimante est éteinte et sort à son retour.
- Le ticket est envoyé en image (PNG, 576 points de large, police DejaVu Sans Condensed) : grandes tailles, accents et « œ » sans dépendre de la page de codes de l'imprimante. Un texte de secours en ASCII existe si l'imprimante ne prend pas l'image.
- Format d'après la v1 §8 : poste et numéro en très grand, mode et heure en grand, client, adresse et compléments, lignes avec `SANS`, `+`, `CHOIX` et la note, ce qui sort à l'autre poste, paiement en clair. Pas de prix.
- Tablette : état de chaque imprimante (en ligne, hors ligne depuis…, plus de papier, capot ouvert), état du ticket de chaque poste, « Réimprimer » (tout ou un poste), « Ticket » en grand en secours. Après trois échecs signalés par l'imprimante, le ticket passe en échec et reste réimprimable.

## Sécurité

- Une adresse par imprimante : `https://<site>/api/cloudprnt/<jeton>`. Le jeton (32 octets aléatoires) n'est montré qu'une fois dans le back-office (rubrique Imprimantes) ; seule son empreinte est en base.
- Au premier passage, l'imprimante est liée à son adresse MAC. Un autre appareil avec le même jeton est refusé. « Nouvelle adresse » coupe l'ancienne et délie l'appareil.
- Une imprimante ne peut lire et confirmer que ses propres tickets.

## Surveillance

Une fois par minute au plus, à chaque passage d'une imprimante ou relecture de la tablette, et chaque minute en production (fonction planifiée Netlify `netlify/functions/surveillance.mts`) :

- une commande du jour pas acceptée après le délai réglé (5 minutes par défaut, back-office) : un e-mail au restaurant (`ALERTE_EMAIL`), une seule fois par commande, et « Attend depuis N min » sur la tablette ;
- la tablette muette depuis 3 minutes pendant un service : commandes en ligne mises en pause, e-mail au restaurant, bandeau sur la tablette. La reprise se fait à la main (« Reprendre les commandes »).

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
   - intervalle d'interrogation : 5 secondes (valeur d'usine) ; on peut monter à 10 secondes pour réduire les requêtes ;
   - pas d'identifiant ni de mot de passe : le jeton de l'adresse suffit.
4. Le certificat HTTPS du site (Netlify) est signé par une autorité courante : rien à installer.
5. Sur la tablette, l'imprimante doit passer « en ligne » dans la minute. Accepter une commande de test : le ticket sort.

## Coût en requêtes

Une imprimante qui interroge toutes les 5 secondes, jour et nuit, fait environ 17 000 requêtes par jour. Éteindre les imprimantes hors service, ou passer l'intervalle à 10 secondes, divise ce nombre. Le plan Netlify et ses quotas sont à vérifier avant la mise en ligne (lot 8).

## Variables à créer (Netlify)

- `ALERTE_EMAIL` : l'adresse du restaurant qui reçoit les alertes (en plus de Resend, voir `docs/comptes.md`).
