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

## Pas encore là

- Ventes par plat, carte de chaleur, zones, nouveaux clients : la fonction `pilotage_analyses` est dans la PR #127. L'écran viendra après son intégration.
