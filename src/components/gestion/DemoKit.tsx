"use client";

import { useMemo, useState } from "react";
import {
  BarreEnregistrer,
  CarteChiffre,
  Champ,
  Chargement,
  EtatErreur,
  EtatVide,
  Onglets,
  PanneauLateral,
  SelecteurPeriode,
  TableauDonnees,
  montant,
  nombre,
  periodeDe,
  useConfirmer,
  useDiffere,
  useFormulaire,
  useNotifier,
  useRaccourci,
  type Colonne,
  type Periode,
  type Tri,
} from "@/components/gestion/ui";
import { jourGeneveDe } from "@/lib/heures";

// Démonstration du kit (/gestion/kit, base embarquée seulement). Données inventées, aucun appel au serveur :
// sert de modèle aux sessions du back-office, aux tests e2e du kit et aux captures.

type Ligne = { id: string; numero: number; client: string; mode: "Livraison" | "À emporter"; total: number; statut: string };
const STATUTS = ["Nouvelle", "Acceptée", "Prête", "Terminée"];
const LIGNES: Ligne[] = Array.from({ length: 237 }, (_, i) => ({
  id: `c${i + 1}`,
  numero: 1000 + i,
  client: `Client essai ${i + 1}`,
  mode: i % 3 === 0 ? "À emporter" : "Livraison",
  total: 1800 + ((i * 731) % 6400),
  statut: STATUTS[i % 4],
}));

const COLONNES: Colonne<Ligne>[] = [
  { cle: "numero", titre: "N°", valeur: (l) => l.numero, triable: true, fixe: true },
  { cle: "client", titre: "Client", valeur: (l) => l.client, triable: true },
  { cle: "mode", titre: "Mode", valeur: (l) => l.mode },
  { cle: "statut", titre: "Statut", valeur: (l) => l.statut, cacheeParDefaut: true },
  { cle: "total", titre: "Total CHF", valeur: (l) => montant(l.total), triable: true, nombre: true },
];

// Simule une réponse du serveur : filtre, tri et page de 25.
function pageServeur(q: string, tri: Tri, page: number) {
  const f = LIGNES.filter((l) => !q || `${l.numero} ${l.client}`.toLowerCase().includes(q.toLowerCase()));
  const s = [...f].sort((a, b) => {
    const x = a[tri.cle as keyof Ligne];
    const y = b[tri.cle as keyof Ligne];
    return (x < y ? -1 : x > y ? 1 : 0) * (tri.sens === "asc" ? 1 : -1);
  });
  return { lignes: s.slice((page - 1) * 25, page * 25), total: f.length, toutes: s };
}

export function DemoKit() {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [recherche, setRecherche] = useState("");
  const q = useDiffere(recherche, 250);
  const [tri, setTri] = useState<Tri>({ cle: "numero", sens: "desc" });
  const [page, setPage] = useState(1);
  const [ouverte, setOuverte] = useState<Ligne | null>(null);
  const [onglet, setOnglet] = useState("tableau");
  const [periode, setPeriode] = useState<Periode>(() => periodeDe("7jours", jourGeneveDe(new Date())));
  const [retires, setRetires] = useState<string[]>([]);
  const donnees = useMemo(() => pageServeur(q, tri, page), [q, tri, page]);

  useRaccourci("n", () => notifier({ texte: "Raccourci N : nouvelle commande (démonstration).", ton: "info" }), "Nouvelle commande (démonstration)");

  async function retirer(cles: string[], vider: () => void) {
    const n = cles.length;
    const ok = await confirmer({ titre: `Archiver ${n} commande${n > 1 ? "s" : ""} ?`, texte: "Démonstration : rien n'est envoyé.", oui: `Archiver ${n}`, danger: true });
    if (!ok) return;
    setRetires((r) => [...r, ...cles]);
    vider();
    notifier({ texte: `${n} archivée${n > 1 ? "s" : ""}.`, ton: "succes", annuler: () => setRetires((r) => r.filter((k) => !cles.includes(k))) });
  }

  return (
    <div className="bo-demo">
      <p className="aide">Démonstration du kit, visible seulement avec la base embarquée. Mode d&apos;emploi : docs/vague-3/kit-back-office.md. Appuyez sur « ? » pour les raccourcis.</p>
      <section aria-labelledby="demo-chiffres">
        <h2 id="demo-chiffres">Cartes de chiffres</h2>
        <div className="bo-chiffres">
          <CarteChiffre libelle="Ventes du soir" valeur={montant(184250)} unite="CHF" comparaison={{ valeur: 184250, reference: 164500, contre: "vendredi dernier" }} />
          <CarteChiffre libelle="Commandes" valeur={nombre(61)} comparaison={{ valeur: 61, reference: 66, contre: "vendredi dernier" }} lien={{ href: "/gestion/commandes", texte: "Voir les commandes" }} />
          <CarteChiffre libelle="À accepter" valeur="3" aide="La plus ancienne attend depuis 4 min." />
          <CarteChiffre libelle="Panier moyen" valeur={montant(3020)} unite="CHF" comparaison={{ valeur: 3020, reference: 3020, contre: "vendredi dernier" }} />
        </div>
      </section>

      <Onglets
        libelle="Parties de la démonstration"
        onglets={[
          { cle: "tableau", titre: "Tableau", badge: retires.length || undefined },
          { cle: "formulaire", titre: "Formulaire" },
          { cle: "etats", titre: "États" },
        ]}
        actif={onglet}
        onChange={setOnglet}
      >
        {onglet === "tableau" && (
          <TableauDonnees<Ligne>
            titre="Commandes de démonstration"
            colonnes={COLONNES}
            lignes={donnees.lignes.filter((l) => !retires.includes(l.id))}
            cleLigne={(l) => l.id}
            tri={tri}
            onTri={(t) => {
              setTri(t);
              setPage(1);
            }}
            pagination={{ page, parPage: 25, total: donnees.total, onPage: setPage }}
            recherche={{
              valeur: recherche,
              onChange: (v) => {
                setRecherche(v);
                setPage(1);
              },
              libelle: "Numéro ou client",
            }}
            filtres={<SelecteurPeriode valeur={periode} onChange={setPeriode} />}
            actionsLot={(cles, vider) => (
              <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={() => retirer(cles, vider)}>
                Archiver
              </button>
            )}
            onOuvrir={setOuverte}
            csv={{ toutes: async () => donnees.toutes }}
            vide={{ titre: "Aucune commande ne correspond.", texte: "Essayez un autre numéro ou effacez la recherche." }}
            memoire="demo"
          />
        )}
        {onglet === "formulaire" && <DemoFormulaire />}
        {onglet === "etats" && (
          <div className="bo-demo-etats">
            <Chargement lignes={3} />
            <EtatVide titre="Aucune commande aujourd'hui." texte="Les commandes du jour s'affichent ici dès la première." />
            <EtatErreur texte="La liste n'a pas pu être chargée." reessayer={() => notifier({ texte: "Nouvel essai (démonstration).", ton: "info" })} />
            <button type="button" className="bo-bouton bo-bouton-second" onClick={() => notifier({ texte: "Imprimante Pizza hors ligne.", ton: "erreur" })}>
              Montrer une notification d&apos;erreur
            </button>
          </div>
        )}
      </Onglets>

      {ouverte && (
        <PanneauLateral
          titre={`Commande ${ouverte.numero}`}
          sousTitre={`${ouverte.client}, ${ouverte.mode.toLowerCase()}`}
          onFermer={() => setOuverte(null)}
        >
          <DemoFormulaire initial={ouverte.client} />
        </PanneauLateral>
      )}
    </div>
  );
}

function DemoFormulaire({ initial = "Pizza essai" }: { initial?: string }) {
  const notifier = useNotifier();
  const f = useFormulaire(
    { nom: initial, prix: "18.50" },
    {
      valider: (v) => ({
        ...(v.nom.trim() ? {} : { nom: "Le nom est obligatoire." }),
        ...(/^\d+(\.\d{1,2})?$/.test(v.prix) && Number(v.prix) > 0 ? {} : { prix: "Un prix comme 18.50, plus grand que 0." }),
      }),
      enregistrer: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, statut: 200, donnees: {} };
      },
      apres: () => notifier({ texte: "Enregistré (démonstration).", ton: "succes" }),
    },
  );
  return (
    <form className="bo-demo-form" onSubmit={f.soumettre} noValidate>
      <Champ libelle="Nom affiché" erreur={f.erreurs.nom}>
        {(a) => <input {...a} value={f.valeurs.nom} onChange={(e) => f.changer("nom", e.target.value)} />}
      </Champ>
      <Champ libelle="Prix (CHF)" aide="Le prix de la salle." erreur={f.erreurs.prix}>
        {(a) => <input {...a} inputMode="decimal" value={f.valeurs.prix} onChange={(e) => f.changer("prix", e.target.value)} />}
      </Champ>
      <BarreEnregistrer etat={f.etat} message={f.message} modifie={f.modifie} reinitialiser={f.reinitialiser} />
    </form>
  );
}
