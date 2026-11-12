# Audit « journée du gérant »

Le site vu par Giuseppe, Jérémy et l'équipe en salle, qui s'en serviront tous les jours sans être informaticiens. Audit fait le 12.11.2026 sur `main` (commit d95375f).

## Terrain et méthode

- Instance locale dans le worktree, build de production avec la base embarquée (`BASE_LOCALE=1 npm run build`, puis `next start -p 3105`). Rien n'a touché la base Supabase partagée ni Netlify.
- Tablette jouée en 1024 × 768, back-office en 375 × 812 (téléphone), dans le navigateur intégré. Comptes de test de `supabase/local/donnees-test.sql` (`gerant-bureau@laferme.test`, `gerant-mobile@laferme.test`).
- Commandes de test créées par l'API locale (`/api/commandes` et la doublure de paiement), avec l'heure simulée des préversions : n° 1 retrait au comptoir, n° 2 retrait payé en ligne, n° 3 livraison à Onex payée en ligne, n° 4 retrait payé pour le samedi 14.11, n° 5 retrait au comptoir pour le vendredi 13.11.
- Tableau `docs/validation-carte.xlsx` rempli dans une copie locale avec des valeurs de test et des erreurs typiques, puis importé (aperçu et application) par l'API du back-office.
- Pas d'imprimante physique. Une imprimante a été simulée par l'adresse CloudPRNT (état « plus de papier »). Tout ce qui touche au papier réel est marqué « supposé ».
- La préversion en ligne n'a pas été ouverte : elle tourne sur le même code que `main`. L'instance locale permettait de tout modifier sans gêner les autres audits.

Dans chaque constat, « vérifié » veut dire reproduit à l'écran ou par l'API locale, « lu » veut dire constaté dans le code sans le jouer, « supposé » veut dire déduit sans preuve.

## Suivi des corrections (14.11.2026)

Corrigé sur la branche `claude/audit-gerant-312b49`, migration `supabase/migrations/20261114090000_correctifs_gerant.sql`. Tests : `tests/unit/gerant-correctifs-sql.test.ts` (base), `tests/unit/gerant-correctifs.test.ts` (serveur), `tests/e2e/gestion.spec.ts` (écrans). Captures avant et après : `docs/rendus/correctifs-gerant/`. Mode d'emploi à jour : `docs/mode-emploi.md`.

| Constat | État | Comment |
|---|---|---|
| G01 | corrigé (PR #20) | « Retirée et payée » au comptoir, « Encaissée » encore possible dans « Terminées » |
| G02 | corrigé | Back-office, rubrique « Commandes », fiche de la commande : « Rembourser » après « Prête », « Partie » ou « Terminée », en entier ou en partie, avec motif envoyé au client. Gérant seulement, journalisé. Une clé par geste : un double appui ou une reprise après coupure ne rembourse pas deux fois (base et Stripe). Un échec Stripe ne compte pas. Au comptoir, rendu en espèces noté. L'export liste les remboursements en négatif au jour du remboursement et retire le remboursé du total par taux |
| G03 | corrigé | Rubrique « Équipe » : ajouter, changer l'accès, déconnecter partout, retirer (sessions coupées tout de suite), remettre. Jamais moins d'un gérant actif (verrou en base). On ne peut ni se retirer ni se rétrograder soi-même à l'écran |
| G04 | corrigé | Rubrique « Commandes », ouverte par défaut : les 7 derniers jours (commandes, ventes, remboursé, refusées, comptoir pas encore encaissé), recherche par nom, téléphone ou numéro sur 90 jours, ou par période. Recherche en POST, jamais dans une adresse |
| G05 | corrigé | « Retard ce soir » sur la tablette (0 à 90 min), ajouté au retrait et à chaque zone pour toutes les heures annoncées. Le délai habituel passe au back-office |
| G06 | corrigé | Remise à zéro chaque nuit à 5h (heure de Genève) par la surveillance : livraison rouverte, retard à zéro, « Pause jusqu'à reprise » levée. La pause automatique reste |
| G09 | corrigé | Motif « À la demande du client », bouton « Annuler et rembourser », lien « Fermer ». Courriel « Votre commande est annulée, comme vous nous l'avez demandé » |
| G10 | corrigé | « Nouvelle adresse » et « Désactiver » demandent une confirmation qui nomme l'imprimante |
| SS-02 côté client | corrigé | Les créneaux pleins ne sont plus proposés dans le sélecteur d'heure : le premier proposé est le suivant libre (fonction `creneaux_pleins`, sans donnée de client, lue par `/api/accueil`) |
| G11 | en partie | Le journal résume en clair l'équipe et les remboursements. Le reste du journal et le retour arrière restent à faire |
| G18 | en partie | Les rubriques passent à la ligne au téléphone (plus rien de caché à droite) |
| G07, G08 | propositions | Voir « Propositions » ci-dessous |
| G12 à G17, G19 à G21 | restants | Hors de ce lot |

## Propositions (non codées)

### G07 : un plat manque sur une commande déjà passée

| Option | Ce que ça fait | Effort |
|---|---|---|
| A | Rupture des suppléments sur la tablette (même mécanisme que les plats, retour seul le lendemain). Remboursement partiel ouvert dès l'acceptation pour le gérant, avec le motif « Plat épuisé » | Moyen, 2 jours |
| B | Modifier une commande acceptée : retirer ou remplacer une ligne, nouveau total, ticket « MODIFIÉE » aux postes, remboursement de la différence, e-mail au client | Gros, 4 à 5 jours |

Recommandation : A d'abord. B règle aussi la modification demandée par téléphone (fonction manquante 9).

### G08 : commande pour un autre jour imprimée tout de suite

| Option | Ce que ça fait | Effort |
|---|---|---|
| A | Accepter garde la commande dans « À l'avance ». Les tickets sortent le jour J, à l'ouverture du service, créés par la surveillance | Moyen, 1 jour (avec SS-11) |
| B | « Accepter » grisé jusqu'au jour J, avec « Confirmée par e-mail le jour même » | Petit, mais le client attend sa confirmation |

Recommandation : A.

### Fonctions manquantes encore ouvertes, classées

| Rang | Fonction | Proposition | Effort |
|---|---|---|---|
| 1 | Plat du jour | Rubrique « Plat du jour » : nom, prix, description, poste, date. Affiché en tête de la carte ce jour-là, imprimé comme un plat | Moyen |
| 2 | Fermer un seul service à une date | Fermeture avec « midi », « soir » ou « journée » | Petit à moyen |
| 3 | Modifier une commande (adresse, ajout) | Option B de G07 | Gros |
| 4 | Ajouter un plat ou une catégorie | Bouton « Nouveau plat » dans « Carte », bloqué tant que prix, allergènes et provenance ne sont pas validés | Moyen |
| 5 | Envoyer une photo | Envoi dans Supabase Storage, recadrage et compression côté serveur, seulement pour le gérant | Gros |
| 6 | Retour arrière depuis le journal | « Remettre l'ancienne valeur » sur prix, zones et fermetures | Moyen |
| 7 | Communes d'une zone | Ajouter ou retirer un NPA dans « Livraison et horaires » | Petit |

## Les 10 constats les plus importants

| Rang | Id | Gravité | Constat | Effort |
|---|---|---|---|---|
| 1 | G01 | Bloquant | Une commande « à encaisser au comptoir » passée à « Retirée » sans toucher « Encaissée » ne peut plus jamais être encaissée. Elle disparaît de l'export comptable | Petit |
| 2 | G02 | Bloquant | Aucun remboursement possible après « Prête » ou « Partie », ni remboursement partiel. Un client mécontent ne peut être remboursé que dans le tableau de bord Stripe | Moyen |
| 3 | G03 | Bloquant | Ajouter ou retirer un employé se fait seulement en SQL dans Supabase. Un employé parti garde l'accès à la tablette | Petit |
| 4 | G04 | Important | Aucune liste des commandes passées. Impossible de retrouver la commande d'un client d'hier, de chercher par nom ou téléphone, de savoir combien de commandes hier | Moyen |
| 5 | G05 | Important | Le délai de préparation de la tablette ne change rien pour la livraison. Allonger la livraison un soir de rush demande le back-office, zone par zone, au gérant | Moyen |
| 6 | G06 | Important | Pause « jusqu'à reprise », livraison fermée et délai allongé restent actifs le lendemain et la semaine suivante, sans rappel | Petit |
| 7 | G07 | Important | Un plat manque sur une commande déjà passée : la seule issue est de refuser toute la commande. Les suppléments (burrata, jambon cru…) ne peuvent pas être mis en rupture depuis la tablette | Gros |
| 8 | G08 | Important | Accepter une commande pour un autre jour imprime le ticket tout de suite et la range dans « En cours » avec celles du soir | Moyen |
| 9 | G09 | Important | « Annuler la commande » à la demande du client envoie « Nous ne pouvons pas préparer votre commande » et le bouton dit « Refuser et rembourser ». Le petit lien « Annuler » à côté ferme seulement le panneau | Petit |
| 10 | G10 | Important | « Nouvelle adresse » d'une imprimante part en un appui sans confirmation. Elle coupe l'imprimante en plein service | Petit |

## Ce qui marche bien

- Rupture du jour (vérifié) : trois appuis et une recherche. La carte publique affiche « Épuisé pour aujourd'hui » tout de suite et le serveur refuse une commande qui contient le plat.
- Pause des commandes et livraison fermée (vérifié) : l'accueil public reçoit l'état dans la seconde. La pause de 30 minutes reprend seule.
- Prix changé dans le back-office (vérifié) : visible sur `/carte` dès l'enregistrement, sans attendre un nouveau build.
- Messages d'erreur en français clair (vérifié). Exemple : « Prix invalide : un montant en francs, par exemple 18 ou 4.50 ». Une heure d'acceptation passée est refusée par le serveur.
- Carte de commande sur la tablette (vérifié) : numéro géant, mode et heure en grand, note du client entre guillemets, `CHOIX` et `SANS` lisibles, téléphone cliquable, paiement en clair (« À encaisser au comptoir CHF 61.00 »).
- Refus d'une commande payée (vérifié) : remboursement complet automatique, message « Commande refusée et remboursée. », e-mail au client.
- Import du tableau (vérifié) : aperçu avant et après par plat, avertissements par numéro de ligne (« Ligne 8 : « Pizza Ferari » n'existe pas dans la carte du site, ligne ignorée. »), rien n'est écrit avant « Appliquer ».
- Fermeture exceptionnelle (vérifié) : une fermeture d'un jour bloque bien les commandes de ce jour.
- Export comptable (vérifié) : CSV à point-virgule pour Excel suisse, sans nom de client, total par taux. TVA recalculée à la main sur les deux ventes de test (63.90 et 61.00 à 2,6 % donnent 1.62 et 1.55, total 3.17) : juste.
- Journal (vérifié) : chaque modification du back-office est datée avec son auteur.

## Constats détaillés

### G01 · Bloquant · Commande au comptoir jamais encaissée

| | |
|---|---|
| Où | `/tablette`, onglet « En cours » puis « Terminées » ; `src/components/tablette/Tablette.tsx:506` (bouton « Encaissée » seulement de « Acceptée » à « Partie ») |
| Reproduire | Commande n° 1, retrait payé au comptoir. Accepter, « Prête au comptoir », puis « Retirée » sans toucher « Encaissée » |
| Attendu | Le client a payé au comptoir. On doit pouvoir le noter, même après coup |
| Observé (vérifié) | Dans « Terminées », la carte reste « À encaisser au comptoir CHF 61.00 » sans aucun bouton. L'export du mois ne contient pas la commande n° 1 (deux lignes sur trois ventes) |
| Correction | Au comptoir, un seul bouton « Retirée et payée ». Garder « Encaissée » dans « Terminées ». Sur le back-office, liste des commandes non encaissées |
| Effort | Petit |

### G02 · Bloquant · Pas de remboursement après coup ni partiel

| | |
|---|---|
| Où | `/tablette` ; `src/components/tablette/Tablette.tsx:514` (« Annuler la commande » masqué pour « Prête » et « Partie ») ; `src/lib/tablette.ts` (remboursement seulement sur un refus, toujours total) |
| Reproduire | Commande n° 3 livrée. Le client appelle : pizza froide, il veut être remboursé de la pizza |
| Attendu | Retrouver la commande, rembourser 21 francs ou le tout, avec une trace |
| Observé (lu, puis vérifié sur l'écran « Terminées ») | Aucun bouton sur une commande « Partie » ou « Livrée ». Le remboursement partiel n'existe nulle part. Il faut se connecter au tableau de bord Stripe, ce que Giuseppe ne fera pas un samedi soir |
| Correction | Sur le back-office, fiche commande avec « Rembourser » et un montant, motif obligatoire, e-mail au client, ligne de remboursement dans l'export |
| Effort | Moyen |

### G03 · Bloquant · Personnel géré en SQL

| | |
|---|---|
| Où | `docs/tablette.md` (« Ajouter ou retirer quelqu'un, dans l'éditeur SQL de Supabase ») ; aucune rubrique dans `/gestion` |
| Reproduire | Un serveur part. Le retirer |
| Attendu | Back-office, rubrique Équipe, « Retirer » |
| Observé (vérifié) | Les sept rubriques sont Carte, Suppléments et pâtes, Livraison et horaires, Imprimantes, Importer le tableau, Export comptable, Journal. Rien pour l'équipe. Sa session de 60 jours reste valable tant qu'on ne passe pas `actif = false` en SQL |
| Correction | Rubrique « Équipe » : nom, e-mail, rôle, retirer. Les sessions du membre retiré tombent tout de suite (déjà prévu côté base) |
| Effort | Petit |

### G04 · Important · Aucune liste ni recherche des commandes

| | |
|---|---|
| Où | `/tablette` (« Terminées » ne montre que la journée, `supabase/migrations/20261109090000_tablette.sql:220`) ; `/gestion` sans rubrique Commandes |
| Reproduire | Lundi, un client appelle pour sa commande de samedi. Ou Giuseppe demande combien de commandes hier |
| Attendu | Chercher par numéro, nom ou téléphone. Voir le nombre de commandes et le chiffre du jour |
| Observé (vérifié) | Impossible sur l'écran. Le seul moyen est l'export CSV, qui ne compte que les ventes encaissées et ne donne ni nom ni téléphone |
| Correction | Rubrique « Commandes » au back-office : liste par jour, recherche, compteur du jour et de la veille, accès à la fiche (G02) |
| Effort | Moyen |

### G05 · Important · Délai de livraison réglable seulement au back-office

| | |
|---|---|
| Où | Tablette, « Délai de préparation » ; `src/lib/service.ts:141` et `src/lib/tablette.ts:64` (livraison = délais de la zone) |
| Reproduire | Samedi 20h, débordés. Toucher +5 trois fois sur la tablette |
| Attendu | Les clients en livraison voient aussi un délai plus long |
| Observé (lu, texte vérifié) | La tablette le dit en petit : « Sert à l'heure « dès que possible » proposée aux clients pour le retrait. » Pour la livraison, il faut le back-office, rubrique Livraison et horaires, puis changer « Délai annoncé, de » et « à » des trois zones (une douzaine d'appuis, compte gérant seulement). Le changement est permanent et valide la zone au passage |
| Correction | Un seul réglage « Retard ce soir : +15 min » sur la tablette, ajouté au retrait et aux zones, remis à zéro chaque nuit |
| Effort | Moyen |

### G06 · Important · Réglages qui restent d'un jour à l'autre

| | |
|---|---|
| Où | Tablette, réglages ; `supabase/migrations/20261111090000_impression.sql:317` (aucune remise à zéro) |
| Reproduire | Samedi soir, « Fermer la livraison » (livreur malade) et délai à 40 min. Mardi, « Démarrer le service » |
| Attendu | Mardi repart des valeurs normales, ou la tablette demande « La livraison est fermée depuis samedi. La rouvrir ? » |
| Observé (lu) | La livraison reste fermée et le délai à 40 min jusqu'à ce que quelqu'un y pense. Seule la petite ligne grise en haut le dit (« Livraison fermée. Préparation 40 min. »). Même chose pour « Pause jusqu'à reprise » |
| Correction | Remise à zéro chaque nuit de la livraison fermée, de la pause sans fin et du délai. Ou un écran de démarrage qui liste ce qui est encore fermé |
| Effort | Petit |

### G07 · Important · Rupture sur une commande déjà passée

| | |
|---|---|
| Où | Tablette, carte de commande ; réglages « Épuisés aujourd'hui » |
| Reproduire | 19h30, plus de burrata. Une commande arrivée à 19h25 contient une Miss Italia |
| Attendu | Retirer la ligne ou proposer un remplacement, rembourser la différence. Mettre le supplément « Burrata » en rupture |
| Observé (vérifié) | Seuls « Accepter » ou « Refuser » toute la commande. Les ruptures ne listent que les plats (80 lignes), pas les suppléments. Un supplément se retire seulement au back-office (« Proposé »), de façon permanente |
| Correction | Court terme : appeler le client, puis refuser et le laisser recommander (à écrire dans le mode d'emploi). Ensuite : retrait d'une ligne avec remboursement partiel (lié à G02), rupture des suppléments sur la tablette |
| Effort | Gros |

### G08 · Important · Commande pour un autre jour imprimée tout de suite

| | |
|---|---|
| Où | Tablette, onglet « À l'avance » ; `src/lib/tablette.ts` (`accepter` lance `imprimerCommande` dans tous les cas) |
| Reproduire | Jeudi, accepter la commande n° 5 demandée pour le vendredi 13 à 19h30 |
| Attendu | Accepter jeudi, imprimer vendredi en début de service. La commande reste dans « À l'avance » jusqu'au jour J |
| Observé (vérifié) | Le ticket part en file tout de suite (« Ticket pizza : en file. »). La commande passe dans « En cours » au milieu des commandes du soir. Le bouton dit « Accepter pour 19h30 » sans la date. Le ticket porte bien le jour (lu, `src/lib/impression/ticket.ts:59`) |
| Correction | Imprimer à l'ouverture du service du jour J. Garder la commande dans « À l'avance ». Mettre la date sur le bouton |
| Effort | Moyen |

### G09 · Important · Annulation à la demande du client

| | |
|---|---|
| Où | Tablette, « Annuler la commande » ; `src/lib/courriel/modeles.ts:91` |
| Reproduire | Le client de la commande n° 2 appelle pour annuler. Toucher « Annuler la commande » |
| Attendu | Un motif « À la demande du client », un bouton « Annuler et rembourser », un e-mail qui ne dit pas que le restaurant ne peut pas |
| Observé (vérifié) | Trois motifs côté restaurant, il faut taper le sien au clavier. Le bouton dit « Refuser et rembourser CHF 61.00 ». Juste à côté, un lien « Annuler » qui ne fait que fermer le panneau. L'e-mail envoyé dit « Nous ne pouvons pas préparer votre commande n° 2. Annulée à la demande du client. » Modifier une commande (ajouter une pizza, changer une adresse) est impossible |
| Correction | Motif prêt « À votre demande ». Bouton « Annuler et rembourser ». Lien « Fermer » au lieu de « Annuler ». E-mail adapté au motif |
| Effort | Petit |

### G10 · Important · « Nouvelle adresse » d'imprimante sans confirmation

| | |
|---|---|
| Où | `/gestion`, Imprimantes ; `src/components/gestion/GestionImprimantes.tsx:77` |
| Reproduire | Toucher « Nouvelle adresse » à côté de « Imprimante pizza » |
| Attendu | « L'imprimante pizza n'imprimera plus tant qu'on n'a pas collé la nouvelle adresse dans ses réglages. Continuer ? » |
| Observé (vérifié) | Nouvelle adresse générée au premier appui. Le journal note seulement « imprimante 1 · nouveau_jeton : vide → oui ». Sur téléphone, le lien est à un doigt de « Désactiver », lui aussi sans confirmation |
| Correction | Confirmation avec le nom de l'imprimante. Bloquer pendant un service ou l'annoncer sur la tablette |
| Effort | Petit |

### G11 · Important · Journal peu lisible et sans retour arrière

| | |
|---|---|
| Où | `/gestion`, Journal ; `src/components/gestion/BackOffice.tsx:276` ; `src/app/api/gestion/journal/route.ts` (200 dernières lignes) |
| Reproduire | Changer un prix, ajouter une fermeture, importer le tableau, ouvrir le Journal au téléphone |
| Observé (vérifié) | La colonne « Quoi » montre des identifiants techniques (« plat pizza-margherita », « fermeture 2 Suppression », « imprimante 1 »). « Prix à valider : oui → non » est une double négation. Une fermeture supprimée ne dit pas quelles dates. Au téléphone, la colonne « Avant → après » sort de l'écran. Un import écrit une ligne par plat (120 lignes pour un import), donc deux imports cachent tout le reste. Les gestes de la tablette (pause, livraison fermée, ruptures, refus) n'y sont pas. Aucun bouton pour revenir en arrière |
| Correction | Nom du plat au lieu de l'identifiant, phrase lisible (« Prix de la Margherita : 19.50 → 21.00 »), une ligne par import, journal de la tablette dans le même écran, bouton « Remettre l'ancienne valeur » sur les prix, zones et fermetures. Mise en page en cartes sur téléphone |
| Effort | Moyen |

### G12 · Important · Retraits gratuits à valider un par un

| | |
|---|---|
| Où | `/gestion`, Carte, fiche du plat ; `src/lib/gestion-import.ts` (la colonne « Retraits gratuits proposés » n'est pas lue) |
| Reproduire | Importer le tableau rempli |
| Observé (vérifié) | Après l'import de test, 39 plats bloquent encore la mise en ligne, dont 25 pour « retraits à valider ». Le tableau a bien la colonne, mais pas en jaune et elle n'est pas importée. Il faut ouvrir 25 fiches et toucher « Valider ces retraits » : environ 50 appuis |
| Correction | Rendre la colonne jaune et l'importer comme les autres |
| Effort | Petit |

### G13 · Important · L'exemple du tableau devient une provenance publique

| | |
|---|---|
| Où | `docs/validation-carte.xlsx`, onglet Lisez-moi ligne 14 ; `src/lib/gestion-import.ts:51` |
| Reproduire | Écrire « (pas de viande) » dans la provenance, comme l'exemple du Lisez-moi. Écrire « aucun » dans les allergènes |
| Observé (vérifié) | Sur la Pizza 4 Stagioni (jambon), l'aperçu remplace « à fournir : jambon » par « (pas de viande) », ce qui lève le blocage et affiche ce texte au client. « aucun » passe aussi comme allergène valide |
| Correction | Retirer l'exemple ou écrire « laisser vide s'il n'y a ni viande ni poisson ». Refuser une provenance qui commence par une parenthèse. Avertir sur « aucun » pour un plat avec gluten connu |
| Effort | Petit |

### G14 · Confort · Difficultés du tableau de validation lui-même

| | |
|---|---|
| Où | `docs/validation-carte.xlsx` |
| Observé (vérifié) | Prix validé à retaper sur 80 lignes même quand le prix salle est juste (pas de case « ok »). « 18.- », l'écriture suisse courante, est refusé comme « CHF 22 » avec un avertissement clair. « x » dans Commandable est refusé. La liste déroulante des suppléments s'arrête à la ligne 30, ce qui est juste mais rien ne le dit. La case « Nombre maximum validé » (onglet Suppléments) n'est pas importée. Un supplément au nom modifié est ignoré sans avertissement (`gestion-import.ts:162`). « Allergènes » est un texte libre sans liste des 14. Les lignes ignorées n'empêchent pas « Appliquer », il faut corriger et réimporter |
| Correction | Accepter « 18.- ». Colonne « Prix salle juste ? oui ». Liste déroulante des 14 allergènes. Avertir sur un supplément inconnu. Importer le maximum de suppléments |
| Effort | Petit |

### G15 · Important · Fermetures sans garde-fou

| | |
|---|---|
| Où | `/gestion`, Livraison et horaires, Fermetures |
| Reproduire | Ajouter « Vacances test » du 14 au 21 novembre alors que la commande n° 4 (payée) est prévue le 14 |
| Observé (vérifié) | « Fermeture ajoutée. » sans alerte. La commande n° 4 reste dans « À l'avance » de la tablette sans marque. « Supprimer » une fermeture part en un appui. Fermer un seul service (ce soir, ou le midi du 8 décembre) est impossible : une fermeture couvre des jours entiers |
| Correction | Lister les commandes déjà prises sur la période et proposer de les annuler avec remboursement. Confirmation avant suppression. Fermeture par service |
| Effort | Petit (alerte), moyen (par service) |

### G16 · Important · Déconnexion et reconnexion de la tablette

| | |
|---|---|
| Où | Tablette, lien « Déconnexion » en haut à droite ; `docs/tablette.md` (session de 60 jours) |
| Observé (lu, lien vérifié) | Un appui suffit, sans confirmation, juste à côté de « Pause, délai, ruptures ». Pour revenir, il faut un code envoyé à l'e-mail du membre connecté. Si c'est l'adresse de Giuseppe et qu'il n'est pas là, la tablette reste muette. Au bout de 60 jours la session expire sans prévenir. Tous les gestes sont signés du même nom (celui du compte de la tablette), pas de la personne qui touche |
| Correction | Confirmation de la déconnexion. Une adresse e-mail du restaurant pour la tablette, lue au comptoir. Avertir une semaine avant l'expiration |
| Effort | Petit |

### G17 · Important · Export comptable incomplet pour la fiduciaire

| | |
|---|---|
| Où | `/gestion`, Export comptable ; `supabase/migrations/20261110090000_gestion.sql:288` |
| Observé | Vérifié : les ventes au comptoir non marquées « Encaissée » manquent (G01). Lu : un remboursement fait le mois suivant fait disparaître la vente du mois déjà exporté, sans ligne négative. Supposé : les ventes encaissées au comptoir passent aussi par la caisse du restaurant, qui reste hors du système, d'où un risque de double comptage. Pas de frais Stripe ni de versements, que la fiduciaire demandera. Un seul taux par commande (2,6 %) : juste tant qu'aucune boisson alcoolisée n'est vendue, à confirmer par la fiduciaire pour les frais de livraison |
| Correction | Colonne « déjà en caisse » pour le comptoir, lignes de remboursement datées du jour du remboursement, total du mois en tête. Faire valider le fichier par la fiduciaire avant le lancement |
| Effort | Moyen |

### G18 · Confort · Back-office au téléphone

| | |
|---|---|
| Où | `/gestion` en 375 × 812 |
| Observé (vérifié) | La barre de rubriques coupe à « Livrais » : Imprimantes, Importer, Export et Journal sont cachés à droite sans indice qu'on peut faire glisser. Le bandeau « 80 plats bloquent la mise en ligne » ne se met à jour qu'au rechargement. La photo se choisit dans une liste de 17 noms de fichiers (« prosciuto.jpg », « 4saison.jpg ») sans aperçu. Les suppléments ont chacun leur bouton « Enregistrer » : 29 suppléments, 58 appuis pour tout valider à la main |
| Correction | Rubriques en liste sur téléphone, aperçu de la photo, un seul « Enregistrer » pour les suppléments |
| Effort | Petit |

### G19 · Confort · Mots ambigus

| Écran | Mot | Ce qu'on peut comprendre de travers | Proposition |
|---|---|---|---|
| Tablette, en-tête | « Commandes ouvertes » | Affiché à 2h du matin et un jour de fermeture : on croit que le site prend des commandes | « Commandes en ligne ouvertes » seulement pendant les horaires, sinon « Fermé, prochain service mardi 11h45 » |
| Tablette, ruptures | « Disponible » / « Épuisé » | Le bouton montre l'état, pas l'action : on ne sait pas si toucher « Disponible » le rend disponible | « Disponible · Marquer épuisé » |
| Tablette, livraison | « Accepter pour 02h35 » | Heure de départ du livreur ou d'arrivée chez le client ? | « Livrée vers 02h35 » |
| Tablette, terminées | « Refusée pour 02h20 », « Livrée pour 02h35 » | Heure prévue, pas l'heure réelle | « Refusée à 02h01 », « Livrée (prévue 02h35) » |
| Tablette, à l'avance | « Attend depuis 5 min » | Affiché sur une commande pour samedi | Ne l'afficher que pour le jour même |
| Tablette, hors ligne | « Appelez Jérémy si ça dure » | Nom écrit dans le code, pas de numéro | Numéro réglable au back-office |
| Back-office, horaires | « Première heure », « Dernière heure », « Dernière commande », « Dernière pizza » | Quatre heures sans explication. Livraison ou ouverture ? | Une phrase d'aide sous chaque champ |
| Back-office, carte | « Station (imprimante) », « Commandable » | Mots de développeur | « Imprimé au poste », « En vente sur le site » |
| Back-office, carte | « Prix validé » | Après le lancement, la case ne veut plus rien dire pour Giuseppe | La cacher une fois la carte validée |
| Back-office, journal | « Prix à valider : oui → non » | Double négation | « Prix validé » |

### G20 · Confort · Petits pièges de la tablette

| | |
|---|---|
| Observé (vérifié) | Après « Accepter », aucun message : la commande disparaît de « À accepter » et il faut penser à ouvrir « En cours ». Le bouton « −5 min » descend sans limite (« Accepter pour 01h15 » à 01h57) puis le serveur répond « Choisissez une heure à venir. ». Après un rechargement de la page, l'écran « Démarrer le service » revient et « Continuer sans son » coupe l'alarme pour tout le service. Les réglages ouverts poussent la file des commandes sous 80 lignes de plats |
| Correction | Message court après chaque geste (« Commande 3 acceptée, ticket envoyé »). Borne à l'heure au plus tôt. « Continuer sans son » plus discret et rappel du son coupé en rouge sombre. Réglages en panneau qui se ferme seul |
| Effort | Petit |

### G21 · Supposé · Papier et imprimantes

| | |
|---|---|
| Observé | Vérifié : l'état d'une imprimante s'affiche sur la tablette (« hors ligne depuis 02h00 ») avec la phrase « Les tickets attendent et sortiront à son retour. ». Supposé, sans imprimante réelle : fin de rouleau au milieu d'un ticket, ticket coupé mais confirmé. Remplacer une imprimante demande de régler son micrologiciel et sa page web CloudPRNT (`docs/impression.md`), ce que ni Giuseppe ni l'équipe ne feront seuls |
| Correction | Tester à la recette (phase 3 de `docs/mise-en-ligne.md`) : rouleau vide en plein ticket, puis « Réimprimer ». Garder une fiche « Remplacer l'imprimante » pour Jérémy |
| Effort | Petit |

## Fonctions manquantes dès la première semaine (classées)

| Rang | Fonction | Pourquoi dès la première semaine | Contournement aujourd'hui |
|---|---|---|---|
| 1 | Rembourser une commande livrée, en entier ou en partie | Un client mécontent arrive vite | Tableau de bord Stripe, par Jérémy |
| 2 | Liste et recherche des commandes passées, nombre de commandes par jour | Retrouver un client, savoir si le site marche | Export CSV, sans les non-encaissées |
| 3 | Ajouter et retirer un employé | Lancement puis premier départ | SQL dans Supabase, par Claude ou Jérémy |
| 4 | Retard du soir appliqué à la livraison | Premier samedi chargé | Pause des commandes |
| 5 | Retirer une ligne d'une commande | Rupture en plein service | Appeler le client, refuser, il recommande |
| 6 | Rupture d'un supplément | Burrata, jambon cru | Back-office, décocher « Proposé », penser à le remettre |
| 7 | Plat du jour | La salle en a un (fiche de voix validée par Jérémy) | Aucun |
| 8 | Ajouter un plat ou une catégorie, envoyer une photo | Nouvelle pizza, carte d'hiver | Développeur |
| 9 | Modifier une commande (adresse, ajout) | Appel du client | Annuler et faire recommander |
| 10 | Fermer un seul service, ouvrir un jour non prévu | Midi du 8 décembre, dimanche de fête | Pause sans fin sur la tablette |
| 11 | Modifier les communes d'une zone | Demande d'un client voisin | Développeur |
| 12 | Retour arrière depuis le journal | Erreur de prix | Retaper l'ancienne valeur lue dans le journal |

## Les tâches de la semaine, une par une

Les gestes comptent chaque appui ou saisie, sans la connexion. La tablette est en 1024 × 768, le back-office au téléphone.

| Tâche | Où | Gestes | Possible ? | Remarque |
|---|---|---|---|---|
| Ouvrir le service le mardi | Tablette | 1 (« Démarrer le service ») | Oui | Ne signale pas une livraison fermée samedi (G06) |
| Accepter | Tablette | 1, plus 1 par décalage de 5 min | Oui | Pas de message après (G20) |
| Décaler une commande acceptée | Tablette | 3 (« Changer l'heure », ±, « Changer pour ») | Oui | E-mail au client |
| Refuser | Tablette | 3 (« Refuser », motif, confirmer) | Oui | Remboursement automatique si payée |
| Client qui modifie sa commande | Tablette | | Non | Annuler puis faire recommander (G09) |
| Client qui annule | Tablette | 4 plus le clavier | Oui, mal dit | E-mail « nous ne pouvons pas » (G09) |
| Un plat manque à 19h30 | Tablette | 4 (réglages, recherche, saisie, « Disponible ») | Oui pour les plats | Pas pour les suppléments ni les commandes déjà passées (G07) |
| Débordés, tout mettre en pause | Tablette | 2 | Oui | Reprend seule après 30 min ou 1 h |
| Débordés, allonger le délai | Tablette pour le retrait, back-office pour la livraison | 2 par 5 min au retrait, une douzaine pour la livraison | En partie | G05 |
| Livreur malade, fermer la livraison | Tablette | 2 | Oui | Reste fermée le lendemain (G06) |
| Changer le prix d'une pizza | Back-office | 5 | Oui | Visible tout de suite |
| Ajouter un plat | | | Non | Développeur |
| Changer une photo | Back-office | 4 | Seulement parmi 17 fichiers | Pas d'envoi de photo |
| Ajouter un supplément | | | Non | Changer son prix : 3 gestes |
| Retirer un plat de la vente | Back-office | 3 (ouvrir, décocher « Commandable », enregistrer) | Oui | Ou « Épuisé » pour la journée sur la tablette |
| Plat du jour | | | Non | |
| Jour férié, fermeture, vacances | Back-office | 6 plus le clavier | Oui par jours entiers | Pas d'alerte sur les commandes déjà prises (G15) |
| Modifier une zone ou des frais | Back-office | 4 | Oui | Communes non modifiables |
| Retrouver un client mécontent | | | Seulement le jour même | G04 |
| Rembourser en entier ou en partie | | | Non après « Prête » | G02 |
| Chiffres du mois pour la fiduciaire | Back-office | 3 (Export, dates, Télécharger) | Oui | Totaux TVA justes, ventes au comptoir à surveiller (G17) |
| Combien de commandes hier | | | Non à l'écran | Compter les lignes de l'export (G04) |
| Ajouter ou retirer un employé | | | Non | SQL (G03) |
| Changer le rouleau | Imprimante | 0 dans le site | Oui | Réimprimer si un ticket a échoué |
| Ajouter ou remplacer une imprimante | Back-office puis page de l'imprimante | 3 plus le réglage CloudPRNT | Avec Jérémy | G10, G21 |
| Remplir et importer le tableau | Excel puis back-office | 5 cases × 80 lignes, puis 3 | Oui | G12 à G14 |
| Lire le journal, annuler une erreur | Back-office | 1 | Lecture seule | G11 |

## Ce qui suppose encore un développeur

- Équipe (ajout, retrait) : SQL.
- Remboursement après livraison ou partiel : Stripe.
- Ajouter un plat, une catégorie, un supplément, une photo, une commune de livraison : code ou base.
- Remplacer une imprimante : réglages techniques sur l'imprimante.
- Lire les journaux d'erreur (remboursement raté, ticket non créé) : `console.error` côté serveur, invisibles pour le restaurant. La tablette dit seulement « Vérifiez dans Stripe ou appelez Jérémy ».

## Fichiers de l'audit

- Ce rapport.
- `docs/audits/mode-emploi-brouillon.md` : une page pour la tablette, une pour le back-office, avec ce qui existe aujourd'hui.
