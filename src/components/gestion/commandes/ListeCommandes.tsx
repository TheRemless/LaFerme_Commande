"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FicheCommande } from "@/components/gestion/commandes/FicheCommande";
import {
  heureCourte,
  MODE,
  ORDRE_STATUTS,
  PAIEMENT,
  STATUT,
} from "@/components/gestion/commandes/libelles";
import {
  montant,
  PanneauLateral,
  periodeDe,
  SelecteurPeriode,
  TableauDonnees,
  useDiffere,
  type Colonne,
  type Periode,
  type Tri,
} from "@/components/gestion/ui";
import { jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";

// Commandes du back-office (vague 3, bo-commandes) pour 300 commandes par jour : la base pagine, trie et
// filtre (liste_commandes_gestion), l'écran ne fait qu'afficher. Une recherche part en POST : un nom ou un
// téléphone n'apparaît jamais dans une adresse. Sans recherche, la période choisie ; avec une recherche,
// les 90 derniers jours. La liste se relit toutes les 15 secondes quand elle contient aujourd'hui et que
// l'onglet est visible ; seule la dernière réponse demandée s'affiche (règle de la PR #72).

export type LigneCommande = {
  id: string;
  numero: number;
  jour_service: string;
  cree_le: string;
  heure_prevue: string | null;
  quand_type: "asap" | "creneau";
  mode: "livraison" | "retrait";
  statut: string;
  statut_paiement: string;
  moyen_paiement: "en_ligne" | "comptoir";
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  localite: string | null;
  zone_numero: number | null;
  livreur: string | null;
  articles: number;
  total_centimes: number;
  rembourse_centimes: number;
  retard_minutes: number | null;
  notes: number;
  compte: boolean;
};
type Page = {
  total: number;
  compteurs: Record<string, number>;
  lignes: LigneCommande[];
};

const PAR_PAGE = 50;
const RELECTURE_MS = 15_000;

const COLONNES: Colonne<LigneCommande>[] = [
  {
    cle: "numero",
    titre: "N°",
    valeur: (l) => l.numero,
    triable: true,
    fixe: true,
    nombre: true,
  },
  {
    cle: "heure",
    titre: "Heure prévue",
    valeur: (l) =>
      l.heure_prevue ? heureCourte(l.heure_prevue) : "Dès que possible",
    triable: true,
  },
  {
    cle: "client",
    titre: "Client",
    valeur: (l) => `${l.client_prenom} ${l.client_nom}`,
    fixe: true,
  },
  {
    cle: "telephone",
    titre: "Téléphone",
    valeur: (l) => l.client_telephone,
    cacheeParDefaut: true,
  },
  {
    cle: "mode",
    titre: "Mode",
    valeur: (l) =>
      l.mode === "livraison"
        ? `Livraison${l.localite ? `, ${l.localite}` : ""}`
        : MODE.retrait,
  },
  {
    cle: "statut",
    titre: "Statut",
    valeur: (l) => STATUT[l.statut] ?? l.statut,
  },
  {
    cle: "retard",
    titre: "Retard",
    valeur: (l) =>
      l.retard_minutes && l.retard_minutes > 0 ? `${l.retard_minutes} min` : "",
    rendu: (l) =>
      l.retard_minutes && l.retard_minutes > 0 ? (
        <strong>
          {l.statut === "nouvelle"
            ? `attend +${l.retard_minutes} min`
            : `+${l.retard_minutes} min`}
        </strong>
      ) : null,
  },
  {
    cle: "paiement",
    titre: "Paiement",
    valeur: (l) => PAIEMENT[l.statut_paiement] ?? l.statut_paiement,
  },
  {
    cle: "livreur",
    titre: "Livreur",
    valeur: (l) => l.livreur ?? "",
    cacheeParDefaut: true,
  },
  {
    cle: "articles",
    titre: "Articles",
    valeur: (l) => l.articles,
    nombre: true,
    cacheeParDefaut: true,
  },
  {
    cle: "montant",
    titre: "Total CHF",
    valeur: (l) => montant(l.total_centimes),
    triable: true,
    nombre: true,
  },
  {
    cle: "rembourse",
    titre: "Remboursé CHF",
    valeur: (l) => (l.rembourse_centimes ? montant(l.rembourse_centimes) : ""),
    nombre: true,
    cacheeParDefaut: true,
  },
  {
    cle: "cree_le",
    titre: "Passée à",
    valeur: (l) => heureCourte(l.cree_le),
    triable: true,
    cacheeParDefaut: true,
  },
  {
    cle: "notes",
    titre: "Notes",
    valeur: (l) => (l.notes ? l.notes : ""),
    nombre: true,
    cacheeParDefaut: true,
  },
];

// Tri de l'écran → tri connu du serveur.
function triServeur(t: Tri): string {
  if (t.cle === "heure") return "heure";
  if (t.cle === "montant") return "montant";
  if (t.cle === "numero") return "numero";
  return t.sens === "asc" ? "ancien" : "recent";
}

type Filtres = {
  mode: string;
  moyen: string;
  paiement: string;
  en_retard: boolean;
  remboursee: boolean;
  avec_note: boolean;
};
const SANS_FILTRE: Filtres = {
  mode: "",
  moyen: "",
  paiement: "",
  en_retard: false,
  remboursee: false,
  avec_note: false,
};

export function ListeCommandes() {
  const aujourdhui = jourGeneveDe(new Date());
  const [periode, setPeriode] = useState<Periode>(() =>
    periodeDe("aujourdhui", aujourdhui),
  );
  const [statuts, setStatuts] = useState<string[]>([]);
  const [filtres, setFiltres] = useState<Filtres>(SANS_FILTRE);
  const [recherche, setRecherche] = useState("");
  const q = useDiffere(recherche.trim(), 300);
  const [tri, setTri] = useState<Tri>({ cle: "cree_le", sens: "desc" });
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<LigneCommande | null>(null);
  const sequence = useRef(0);

  const corps = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      action: "liste_page",
      ...(q ? { recherche: q } : { debut: periode.debut, fin: periode.fin }),
      ...(statuts.length ? { statuts } : {}),
      ...(filtres.mode ? { mode: filtres.mode } : {}),
      ...(filtres.moyen ? { moyen: filtres.moyen } : {}),
      ...(filtres.paiement ? { paiements: [filtres.paiement] } : {}),
      ...(filtres.en_retard ? { en_retard: true } : {}),
      ...(filtres.remboursee ? { remboursee: true } : {}),
      ...(filtres.avec_note ? { avec_note: true } : {}),
      tri: triServeur(tri),
      page,
      par_page: PAR_PAGE,
      ...extra,
    }),
    [q, periode, statuts, filtres, tri, page],
  );

  const charger = useCallback(async () => {
    const n = ++sequence.current;
    setChargement(true);
    const r = await poster("/api/gestion/commandes", corps());
    if (n !== sequence.current) return; // une demande plus récente est partie : celle-ci ne compte plus
    setChargement(false);
    if (r.ok) {
      setDonnees(r.donnees as unknown as Page);
      setErreur(null);
    } else
      setErreur(
        String(r.donnees.erreur ?? "La liste n'a pas pu être chargée."),
      );
  }, [corps]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Relecture du service en cours : seulement si la liste montre aujourd'hui et que l'onglet est visible.
  const enDirect =
    !q && periode.debut <= aujourdhui && periode.fin >= aujourdhui;
  useEffect(() => {
    if (!enDirect) return;
    const relire = () => document.visibilityState === "visible" && charger();
    const t = window.setInterval(relire, RELECTURE_MS);
    document.addEventListener("visibilitychange", relire);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", relire);
    };
  }, [enDirect, charger]);

  function basculerStatut(s: string) {
    setStatuts((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));
    setPage(1);
  }
  function filtrer<K extends keyof Filtres>(k: K, v: Filtres[K]) {
    setFiltres((f) => ({ ...f, [k]: v }));
    setPage(1);
  }

  // Export : toutes les lignes du filtre, par pages de 100, jusqu'à 5000.
  async function toutes(): Promise<LigneCommande[]> {
    const lignes: LigneCommande[] = [];
    for (let p = 1; p <= 50; p += 1) {
      const r = await poster(
        "/api/gestion/commandes",
        corps({ page: p, par_page: 100 }),
      );
      if (!r.ok)
        throw new Error(String(r.donnees.erreur ?? "Export impossible."));
      const d = r.donnees as unknown as Page;
      lignes.push(...d.lignes);
      if (lignes.length >= d.total || d.lignes.length === 0) break;
    }
    return lignes;
  }

  const compteurs = donnees?.compteurs ?? {};
  const filtresActifs =
    statuts.length > 0 || Object.entries(filtres).some(([, v]) => v);

  return (
    <div className="bo-commandes">
      <div
        className="bo-pastilles"
        role="group"
        aria-label="Filtrer par statut"
      >
        {ORDRE_STATUTS.map((s) => (
          <button
            key={s}
            type="button"
            className="bo-pastille"
            aria-pressed={statuts.includes(s)}
            onClick={() => basculerStatut(s)}
          >
            {STATUT[s]}{" "}
            <span className="bo-pastille-n">{compteurs[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <TableauDonnees<LigneCommande>
        titre="Commandes"
        colonnes={COLONNES}
        lignes={donnees?.lignes ?? null}
        cleLigne={(l) => l.id}
        chargement={chargement && donnees !== null}
        erreur={erreur}
        onReessayer={charger}
        tri={tri}
        onTri={(t) => {
          setTri(t);
          setPage(1);
        }}
        pagination={{
          page,
          parPage: PAR_PAGE,
          total: donnees?.total ?? 0,
          onPage: setPage,
        }}
        recherche={{
          valeur: recherche,
          onChange: (v) => {
            setRecherche(v);
            setPage(1);
          },
          libelle: "Numéro, nom, téléphone ou e-mail",
        }}
        filtres={
          <div className="bo-filtres-commandes">
            <div>
              {q ? (
                <p className="bo-champ-aide">
                  Recherche sur les 90 derniers jours.
                </p>
              ) : (
                <SelecteurPeriode
                  valeur={periode}
                  futur
                  onChange={(p) => {
                    setPeriode(p);
                    setPage(1);
                  }}
                />
              )}
            </div>
            <div className="bo-filtres-ligne">
              <label>
                Mode
                <select
                  value={filtres.mode}
                  onChange={(e) => filtrer("mode", e.target.value)}
                >
                  <option value="">Tous</option>
                  <option value="livraison">Livraison</option>
                  <option value="retrait">À emporter</option>
                </select>
              </label>
              <label>
                Paiement
                <select
                  value={filtres.paiement}
                  onChange={(e) => filtrer("paiement", e.target.value)}
                >
                  <option value="">Tous</option>
                  <option value="paye">Payée en ligne</option>
                  <option value="a_encaisser_retrait">
                    À encaisser au comptoir
                  </option>
                  <option value="encaisse">Payée au comptoir</option>
                  <option value="rembourse">Remboursée</option>
                </select>
              </label>
              <label className="bo-case">
                <input
                  type="checkbox"
                  checked={filtres.en_retard}
                  onChange={(e) => filtrer("en_retard", e.target.checked)}
                />{" "}
                En retard
              </label>
              <label className="bo-case">
                <input
                  type="checkbox"
                  checked={filtres.remboursee}
                  onChange={(e) => filtrer("remboursee", e.target.checked)}
                />{" "}
                Avec remboursement
              </label>
              <label className="bo-case">
                <input
                  type="checkbox"
                  checked={filtres.avec_note}
                  onChange={(e) => filtrer("avec_note", e.target.checked)}
                />{" "}
                Avec note
              </label>
              {filtresActifs && (
                <button
                  type="button"
                  className="bo-bouton bo-bouton-discret bo-bouton-petit"
                  onClick={() => {
                    setStatuts([]);
                    setFiltres(SANS_FILTRE);
                    setPage(1);
                  }}
                >
                  Effacer les filtres
                </button>
              )}
            </div>
          </div>
        }
        onOuvrir={setOuverte}
        csv={{ toutes }}
        memoire="commandes"
        vide={
          q || filtresActifs
            ? {
                titre: "Aucune commande ne correspond.",
                texte: "Essayez un autre nom ou effacez les filtres.",
              }
            : {
                titre: "Aucune commande sur cette période.",
                texte: "Les commandes s'affichent ici dès qu'elles arrivent.",
              }
        }
      />

      {ouverte && (
        <PanneauLateral
          large
          titre={`Commande ${ouverte.numero}`}
          sousTitre={`${ouverte.client_prenom} ${ouverte.client_nom}, ${MODE[ouverte.mode].toLowerCase()}`}
          onFermer={() => setOuverte(null)}
        >
          <FicheCommande id={ouverte.id} onChange={charger} />
        </PanneauLateral>
      )}
    </div>
  );
}
