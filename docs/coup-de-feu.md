# Coup de feu (vague 3, bo-operations)

Un soir chargé, l'équipe durcit le service en un geste au lieu de trois boutons séparés. Tout revient seul à l'heure choisie. Migration `supabase/migrations/20261130090000_coup_de_feu.sql`, serveur `src/lib/coup-de-feu.ts`, route `src/app/api/coup-de-feu/route.ts`.

## Ce que fait le geste

| Réglage | Pendant le coup de feu | À la fin |
|---|---|---|
| Retard des heures annoncées (`retard_minutes`) | Le plus long des deux : le retard déjà réglé ou celui du geste | Valeur d'avant |
| Commandes par créneau, livraisons et retraits | Le plus bas des deux. « Sans limite » (0) prend la valeur du geste | Valeur d'avant |
| Livraison fermée | Fermée si le geste le demande. Une livraison déjà fermée n'est jamais rouverte | Valeur d'avant |
| Pause des commandes en ligne | Inchangée (bouton à part sur la tablette) | Inchangée |

- **Fin** : à l'heure choisie (de 15 minutes à 6 heures), par la surveillance qui tourne chaque minute, ou d'un geste « Fin du coup de feu ».
- **Réglage changé entre-temps** : il n'est pas rendu. Un gérant qui met la capacité des livraisons à 1 en plein coup de feu la garde après.
- **Relancer pendant un coup de feu** : le nouveau geste remplace l'ancien (mêmes valeurs d'avant, même heure de début). Pour prolonger, on relance avec une nouvelle durée.
- **Remise de 5h** : si un coup de feu dure au-delà de 5h (heure de Genève), la remise du jour remet le retard à zéro et rouvre la livraison comme chaque nuit. La fin du coup de feu rend ensuite la capacité.
- **Qui** : l'équipe du restaurant (rôles `service` et `gerant`), sur la tablette ou au back-office. Pas les livreurs. Revérifié en base (`equipe_nom`).
- **Journal** : chaque lancement et chaque fin dans `journal_gestion` (objet `coup_de_feu`, clés `lancer` et `finir`), avec le prénom ou « Fin automatique ». La table `reglages` est lisible par tous : l'état n'y contient aucun nom.

## Valeurs proposées (à valider par Jérémy)

Réglage `coup_de_feu_defaut`, marqué « proposition » : 20 minutes de retard, une heure, 2 livraisons et 2 retraits par créneau (la moitié de 3 et 4, arrondie au-dessus), livraison ouverte. L'écran les propose, l'équipe peut les changer avant de toucher le bouton.

## Contrat de la route (pour la tablette et le back-office)

`GET /api/coup-de-feu` (équipe connectée) :

```json
{
  "en_cours": null,
  "defaut": { "retard_minutes": 20, "duree_minutes": 60, "capacite_livraison": 2, "capacite_retrait": 2, "livraison_fermee": false },
  "defaut_propose": true,
  "actuel": { "retard_minutes": 0, "livraison_fermee": false, "capacite_livraisons_par_creneau": 3, "capacite_retraits_par_creneau": 4 }
}
```

Pendant un coup de feu, `en_cours` vaut `{ debut, jusqua, par, applique, avant }` (dates ISO, `par` : prénom du dernier lancement).

`POST /api/coup-de-feu` avec l'en-tête `Origin` du site :

- `{ "action": "lancer", "retard_minutes": 20, "duree_minutes": 60, "livraison_fermee": false, "capacite_livraison": 2, "capacite_retrait": 2 }`. Capacités absentes ou `null` : inchangées. Au moins un changement. Réponse : l'état ci-dessus avec `enregistre: true`. Erreur de saisie : 422 et `erreur` en français.
- `{ "action": "finir" }`. Réponse : l'état, `enregistre: true`, ou `deja: true` si plus rien n'était en cours (autre appareil, fin automatique).

Après chaque geste : cache de la config vidé (heures annoncées, créneaux pleins, livraison fermée à jour en moins d'une minute partout) et signal Realtime à la tablette.

## Avant et après la migration

Le code marche avant la migration : la surveillance ignore l'absence de `fin_coup_de_feu_echue`, et aucun écran n'appelle encore la route. Après : rien ne change tant que personne ne lance de coup de feu.

## Pas encore fait

- Écran de la tablette (session `tablette`) et du back-office (après la coque de `bo-socle`) : bouton, valeurs proposées modifiables, compte à rebours, « Fin du coup de feu ».
- Réglage des valeurs proposées au back-office.
- Délai par poste (pizza, cuisine) : le retard reste commun aux deux postes.
