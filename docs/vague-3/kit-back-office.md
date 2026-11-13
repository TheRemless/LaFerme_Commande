# Kit du back-office (vague 3)

Pour les sessions qui construisent une rubrique de `/gestion`. Tout est dans `src/components/gestion/ui/` et s'importe d'un seul endroit :

```ts
import { TableauDonnees, PanneauLateral, Champ, useFormulaire, BarreEnregistrer, useConfirmer, useNotifier } from "@/components/gestion/ui";
```

Démonstration vivante : `/gestion/kit`, en local seulement (`BASE_LOCALE=1`, connecté en gérant). Son code (`src/components/gestion/DemoKit.tsx`) est le modèle à copier. Tests : `tests/e2e/gestion-kit.spec.ts`, `tests/unit/kit-gestion.test.ts`.

## Règles communes

- **Pas de styles neufs pour ce que le kit fait déjà.** Boutons `bo-bouton` + `bo-bouton-principal`, `bo-bouton-second`, `bo-bouton-discret` et `bo-bouton-petit`. Les jetons sont dans `src/app/gestion/back-office.css` : `--bo-texte`, `--bo-texte-doux`, `--bo-surface`, `--bo-fond`, `--bo-trait`, `--bo-rayon`, `--bo-cible` (44 px), `--bo-taille` (15 px). Aucune couleur en dur, aucun rouge, aucune ombre. Une erreur se montre par un cadre d'encre épais sur blanc.
- **Une adresse par rubrique**, une ligne dans `src/components/gestion/navigation.ts` (retirer `aVenir` dans la PR qui crée la page). Les onglets internes (`Onglets`) servent seulement à l'intérieur d'une page.
- **Le serveur fait le travail.** Le tableau ne trie ni ne filtre 300 commandes par jour dans le navigateur : la rubrique demande la page voulue (tri, recherche, filtres, `page`, `parPage`) à son API, qui répond `{ lignes, total }`.
- **Rien ne se perd en silence.** Chaque écriture finit par « Enregistré. » ou par un message d'erreur. Une action qui se défait propose « Annuler » dans la notification. Une action qui ne se défait pas passe par `useConfirmer` avec `danger`.
- **Données de clients.** Jamais dans une adresse : la recherche part en POST. Le CSV n'exporte que les colonnes affichées.

## Les pièces

| Pièce | Pour quoi | À savoir |
|---|---|---|
| `TableauDonnees` | Toute liste : commandes, clients, plats, journal | Contrôlé : `tri` et `onTri`, `pagination` (`page`, `parPage`, `total`, `onPage`), `recherche`, `filtres` (n'importe quel élément). `actionsLot(cles, vider)` affiche les cases et la barre de sélection. `onOuvrir(ligne)` rend la ligne cliquable : le premier champ devient un bouton, utilisable au clavier. `csv.toutes()` exporte tout le filtre, sinon la page affichée. `memoire="commandes"` garde les colonnes choisies et la densité. États intégrés : `lignes={null}` affiche le chargement, `erreur` + `onReessayer`, `vide` |
| `Colonne<T>` | Une colonne | `valeur` (texte brut, sert au CSV), `rendu` (affichage), `triable`, `nombre` (aligné à droite, chiffres de même largeur), `fixe` (toujours là), `cacheeParDefaut` |
| `PanneauLateral` | Fiche ouverte depuis une liste | Fenêtre à droite (plein écran sur téléphone). Échap et le fond la ferment, le focus revient à la ligne. Elle demande confirmation si un formulaire dedans a des changements non enregistrés (seulement les siens : un panneau a sa propre portée de garde). `pied` pour les boutons collés en bas, `large` pour 720 px |
| `Champ` | Un champ de formulaire | `libelle`, `aide`, `erreur`, `facultatif`. L'enfant est une fonction qui reçoit `id`, `aria-describedby` et `aria-invalid` : `{(a) => <input {...a} … />}` |
| `useFormulaire` + `BarreEnregistrer` | Un formulaire qui écrit | `useFormulaire(initiales, { valider, enregistrer, apres })` renvoie `valeurs`, `changer`, `erreurs`, `etat`, `message`, `modifie`, `soumettre` et `reinitialiser`. `enregistrer` renvoie la `Reponse` de `poster()`. Le focus va au premier champ faux. La garde des modifications est branchée d'office |
| `useConfirmer()` | « Retirer Marco ? » | `await confirmer({ titre, texte, oui: "Retirer Marco", danger: true })` renvoie `true` ou `false`. Le bouton « oui » nomme l'action, jamais « OK » |
| `useNotifier()` | Retour après une action | `notifier({ texte: "Plat enregistré.", ton: "succes", annuler: () => remettre() })`. Une erreur (`ton: "erreur"`) reste jusqu'à fermeture et elle est annoncée tout de suite |
| `useGardeModifications(modifie)` | Formulaire écrit à la main, sans `useFormulaire` | La coque demande avant de changer de rubrique, de se déconnecter ou de fermer l'onglet |
| `Chargement`, `EtatVide`, `EtatErreur`, `DroitsInsuffisants` | Les états d'un écran | Le bandeau « Pas de connexion » est déjà dans la coque |
| `SelecteurPeriode` + `periodes.ts` | Une période | Raccourcis (Aujourd'hui, Hier, 7 et 30 derniers jours, ce mois-ci, mois dernier) puis deux dates. Refuse un début après la fin et plus de `maxJours`. Dates passées seulement, sauf avec `futur`. `periodeComparaison(p)` donne le même jour la semaine passée pour un jour, sinon la période d'avant |
| `CarteChiffre` | Un chiffre du tableau de bord | `valeur` déjà mise en forme, `comparaison: { valeur, reference, contre: "vendredi dernier" }`. L'écart est écrit (« +12 % contre vendredi dernier »), jamais porté par la seule couleur. Aucun calcul : les chiffres viennent de `bo-pilotage`. Grille : `<div className="bo-chiffres">` |
| `Onglets` | Parties d'une fiche | Onglets ARIA : flèches, Début et Fin. `badge` pour un nombre |
| `useRaccourci(touches, action, description)` | Raccourci clavier | Une lettre, `/`, `?` ou `mod+k` (Ctrl ou ⌘). Ignoré pendant une saisie et quand une fenêtre est ouverte. « ? » liste ceux de la page, et « / » va à la recherche du tableau. `mod+k` est réservé à la recherche globale (bo-socle) |
| `useRelecture(lire, deps, { intervalleMs })` | Liste en direct (commandes du jour, accueil) | Relit seulement quand l'onglet est visible, et tout de suite au retour. Pas de seconde requête tant que la première est en vol. La dernière demande gagne (règle de la PR #72). Une erreur garde les données affichées et montre `messageErreur` (ou le message d’une `ErreurLisible`). Renvoie `donnees`, `erreur`, `majLe`, `chargement` et `recharger()` |
| `Chronologie` | Historique d'une fiche (commande, réclamation, client) | `evenements: { cle, quand, titre, detail?, par?, important? }[]`. Regroupés par jour, l'heure à gauche, le plus récent en haut (`ordre` pour l'inverse) |
| `demanderOuverture` et `useOuverture(type, ouvrir)` | Ouvrir une fiche en arrivant sur une rubrique (recherche globale, accueil, alertes) | La cible passe par le stockage de session, lue une fois et valable 30 secondes : aucun e-mail ni nom dans l'adresse. Types : `commande` (id), `client` (e-mail), `plat` (slug), `reclamation` (id). Chaque rubrique appelle `useOuverture` pour ses fiches |
| `montant`, `nombre`, `ecartTexte` | Écrire les nombres | « 1’234.50 », « −3 % ». Les montants restent en centimes jusqu'à l'affichage |
| `documentCsv`, `telechargerCsv` | Un CSV fait main | Même format que l'export comptable : « ; », BOM et formules neutralisées |
| `IconeGestion` | Pictogrammes au trait | Toujours décoratifs. Pour un bouton sans texte : `aria-label` sur le bouton |

## Modèle de liste avec fiche

```tsx
const [tri, setTri] = useState<Tri>({ cle: "numero", sens: "desc" });
const [page, setPage] = useState(1);
const [recherche, setRecherche] = useState("");
const q = useDiffere(recherche); // la recherche part 300 ms après la dernière frappe
const [donnees, setDonnees] = useState<{ lignes: Commande[]; total: number } | null>(null);
const [erreur, setErreur] = useState<string | null>(null);
const charger = useCallback(async () => {
  const r = await poster("/api/gestion/commandes", { action: "liste", recherche: q, tri, page, parPage: 50 });
  if (r.ok) { setDonnees(r.donnees as never); setErreur(null); } else setErreur(String(r.donnees.erreur ?? "Liste indisponible."));
}, [q, tri, page]);
useEffect(() => { charger(); }, [charger]);

<TableauDonnees<Commande>
  titre="Commandes" colonnes={COLONNES} lignes={donnees?.lignes ?? null} cleLigne={(c) => c.id}
  erreur={erreur} onReessayer={charger}
  tri={tri} onTri={(t) => { setTri(t); setPage(1); }}
  pagination={{ page, parPage: 50, total: donnees?.total ?? 0, onPage: setPage }}
  recherche={{ valeur: recherche, onChange: (v) => { setRecherche(v); setPage(1); }, libelle: "Nom, téléphone ou numéro" }}
  onOuvrir={(c) => setOuverte(c)} memoire="commandes"
  vide={{ titre: "Aucune commande ne correspond.", texte: "Essayez un autre nom ou effacez la recherche." }}
/>
{ouverte && <PanneauLateral titre={`Commande ${ouverte.numero}`} onFermer={() => setOuverte(null)}>…</PanneauLateral>}
```

## Ce que le kit ne fait pas (encore)

- Pas de tableau virtualisé : la pagination côté serveur suffit (50 lignes par page).
- Pas de glisser-déposer : l'ordre des plats garde ses boutons « monter » et « descendre ».
- Le sélecteur de dates est celui du navigateur (`type="date"`), le plus sûr au doigt sur tablette.

Besoin d'une pièce qui manque : écrire à `bo-socle` plutôt que d'en faire une à côté.
