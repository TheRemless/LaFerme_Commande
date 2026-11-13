# Rapports du back-office (vague 3, bo-pilotage)

Rubrique `/gestion/rapports` (groupe Chiffres). Écran `src/components/gestion/Rapports.tsx` et `rapports.css`, construit avec le kit (`docs/vague-3/kit-back-office.md`). Les chiffres viennent de `GET /api/gestion/pilotage/ventes` (fonction `pilotage_ventes`, définitions dans [docs/pilotage.md](pilotage.md)). Rien n'est recalculé dans le navigateur. Test : `tests/e2e/gestion-rapports.spec.ts`. Captures sur le jeu de rush : `docs/rendus/vague-3/bo-pilotage/rapports-*.png`.

## Ce que voit le gérant

- Période : raccourcis du kit (aujourd'hui, hier, 7 et 30 derniers jours, ce mois-ci, mois dernier) ou deux dates, un an au plus. Service : toute la journée, midi ou soir.
- Comparaison : un jour avec le même jour de la semaine d'avant, une période avec la même durée juste avant (« les 7 jours d'avant »). La phrase sous les filtres dit exactement quelles dates.
- L'essentiel : ventes TTC (et hors TVA), commandes, panier moyen, net après remboursements, chacun avec son écart écrit en toutes lettres. Puis part en livraison (et frais encaissés), part payée en ligne (et comptoir), refusées, comptoir pas encore encaissé (lien vers les commandes).
- Ventes par jour (dès deux jours) : barres pour la période, trait pour le jour correspondant de la période d'avant. Une seule échelle, arrondie (25'000 plutôt que 23'083). Chaque jour se lit au survol, au doigt et au clavier. « Voir le tableau jour par jour » donne les mêmes chiffres et les télécharge en CSV.
- Motifs de refus, remboursements (faits, dont en ligne, dont en espèces, pas encore confirmés) et échecs encore ouverts tous jours confondus, TVA par taux avec le net.
- États : chargement, période sans commande, erreur et réseau coupé avec « Réessayer ». Une réponse lente d'une ancienne période n'écrase pas la nouvelle.

## Choix de dessin

- Palette Béton : barres en béton sombre, période d'avant en trait d'encre de 2 px, grille au filet. Les deux séries se distinguent par la forme (barre, trait) et par la légende, pas par la couleur. Le validateur de couleurs du skill dataviz signale deux gris sans teinte (attendu dans le style Béton) et passe la séparation pour les daltonismes (ΔE 32) et le contraste.
- Le dessin a une largeur fixe : le texte garde sa taille quel que soit le nombre de jours. Sur téléphone, le graphique défile dans son cadre, jamais la page (vérifié : 0 px de débordement).

## Onglets d'analyse (Plats, Heures, Zones et clients, Livreurs)

Écran `src/components/gestion/AnalysesRapports.tsx`, route `GET /api/gestion/pilotage/analyses` (fonction `pilotage_analyses`, et `stats_livreurs` de bo-operations reprise telle quelle). Mêmes période et service que l'onglet Ventes. Captures sur le jeu de rush : `docs/rendus/vague-3/bo-pilotage/analyses-*.png`.

- Plats : les vingt mieux vendus (puis « Afficher les … plats »), quantité, CHF et part des ventes de plats, avec leur catégorie. À côté, la même chose par catégorie.
- Heures : carte de chaleur des commandes en moyenne par jour, pour chaque jour de la semaine et heure de service, et la pointe en une phrase. Une seule teinte en cinq marches, le nombre est écrit dans chaque case (aucune information portée par la seule couleur). Les marches foncées passent le texte au blanc, contraste vérifié (au moins 4,5).
- Zones et clients : clients, nouveaux et fidèles (comptés, jamais nommés), livraisons par zone avec frais et panier moyen.
- Livreurs : livraisons, livrées, client absent, problèmes, temps moyen et retard moyen par livreur, sur la journée entière (le choix du service ne s'applique pas ici).
- Onglet Ventes : la carte « Refusées » dit aussi combien de commandes ont été annulées par le client, comptées à part.

## Onglet Temps (temps réels contre temps promis)

Écran `src/components/gestion/TempsRapports.tsx`, route `GET /api/gestion/pilotage/temps`, fonction `pilotage_temps` (migration `supabase/migrations/20261212100000_pilotage_temps.sql`, tests `tests/unit/pilotage-temps-sql.test.ts`). Sources : `commandes`, `commande_postes` de tablette (#172) et le départ du livreur dans `evenements_commande`.

- Acceptation : médiane et 9 sur 10, de la commande payée à « Acceptée ».
- Préparation par poste (four à pizza, cuisine) : des premiers tickets à « Prête » sur le poste. La part des heures déduites du statut de la commande (le poste n'a pas touché « Prête ») est affichée : plus elle est grande, moins la mesure est fine. Après « Rouvrir », c'est la dernière heure « Prête » qui compte.
- Ponctualité : livraisons livrées et retraits prêts à l'heure promise, en retard, de plus de 10 min, retard médian ; route médiane du départ à la livraison.
- Heure par heure (heure promise à Genève) : commandes, en retard, médianes four, cuisine et route. La phrase d'en-tête nomme le créneau le plus en retard (au moins trois commandes).
- Mesure sur le jeu de rush : 30 jours en 38 ms. Le jeu ne remplit pas encore `commande_postes` (demandé à qualite) : les temps par poste y sont vides, la ponctualité et la route sont calculées.

