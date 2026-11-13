"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnnulerLot } from "@/components/gestion/commandes/ActionsLot";
import { useDroit, useRoleGestion } from "@/components/gestion/droits";
import { FicheCommande } from "@/components/gestion/commandes/FicheCommande";
import {
  RACCOURCIS_PERIODE,
  raccourciDe,
  type CleRaccourciPeriode,
} from "@/components/gestion/ui/periodes";
import {
  heureCourte,
  jourCourt,
  MODE,
  ORDRE_STATUTS,
  PAIEMENT,
  STATUT,
} from "@/components/gestion/commandes/libelles";
import {
  ErreurLisible,
  montant,
  PanneauLateral,
  periodeDe,
  SelecteurPeriode,
  TableauDonnees,
  useDiffere,
  useNotifier,
  useOuverture,
  useRelecture,
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
  reclamations?: number;
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
  {
    cle: "reclamations",
    titre: "Réclamations",
    valeur: (l) => (l.reclamations ? l.reclamations : ""),
    nombre: true,
  },
];

// Gestes en lot : seulement ce qui se fait commande par commande sur la tablette, sans montant à choisir.
const ANNULABLE = ["nouvelle", "acceptee", "en_preparation"];
const IMPRIMABLE = [
  "acceptee",
  "en_preparation",
  "prete",
  "partie",
  "terminee",
];

// Jour de service : montré dès que la liste couvre plus d'un jour (les numéros repartent à 1 chaque jour).
const JOUR: Colonne<LigneCommande> = {
  cle: "jour",
  titre: "Jour",
  valeur: (l) => jourCourt(`${l.jour_service}T12:00:00Z`),
  triable: true,
  fixe: true,
};

// Le serveur trie l'heure prévue et le numéro dans l'ordre croissant, le montant dans l'ordre décroissant ;
// la flèche de l'écran suit donc toujours le sens réel des données.
function triPermis(t: Tri): Tri {
  if (t.cle === "heure" || t.cle === "numero")
    return { cle: t.cle, sens: "asc" };
  if (t.cle === "montant" || t.cle === "jour")
    return { cle: t.cle, sens: "desc" };
  return t;
}

// Tri de l'écran → tri connu du serveur.
function triServeur(t: Tri): string {
  if (t.cle === "heure") return "heure";
  if (t.cle === "montant") return "montant";
  // Jour : le plus récent d'abord, puis numéro croissant (le tri « numero » du serveur).
  if (t.cle === "numero" || t.cle === "jour") return "numero";
  return t.sens === "asc" ? "ancien" : "recent";
}

type Filtres = {
  mode: string;
  moyen: string;
  paiement: string;
  en_retard: boolean;
  remboursement: string;
  avec_note: boolean;
  avec_reclamation: boolean;
  service: string;
  zone: string;
  livreur: string;
  montant_min: string;
  montant_max: string;
};
const SANS_FILTRE: Filtres = {
  mode: "",
  moyen: "",
  paiement: "",
  en_retard: false,
  remboursement: "",
  avec_note: false,
  avec_reclamation: false,
  service: "",
  zone: "",
  livreur: "",
  montant_min: "",
  montant_max: "",
};
type Options = {
  zones: { numero: number; nom: string }[];
  livreurs: { id: string; nom: string; actif: boolean }[];
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
  // Fiche ouverte : depuis une ligne, ou depuis la recherche globale (⌘K) qui ne donne que l'identifiant.
  const [ouverte, setOuverte] = useState<{
    id: string;
    titre: string;
    sousTitre?: string;
  } | null>(null);
  useOuverture("commande", (id) => setOuverte({ id, titre: "Commande" }));
  const notifier = useNotifier();
  // Zones et livreurs pour les listes de choix, lus une fois.
  const [options, setOptions] = useState<Options>({ zones: [], livreurs: [] });
  useEffect(() => {
    poster("/api/gestion/commandes", { action: "options_filtres" }).then(
      (r) => r.ok && setOptions(r.donnees as unknown as Options),
    );
  }, []);
  // Les montants partent 500 ms après la dernière frappe (pas une requête par chiffre).
  const montantMin = useDiffere(filtres.montant_min.trim(), 500);
  const montantMax = useDiffere(filtres.montant_max.trim(), 500);
  // Responsable de service (D1) : il annule en lot, la réimpression reste au gérant.
  const gerant = useRoleGestion() === "gerant";
  const peutAnnuler = useDroit("annuler_apres_prete");
  const [annulerLot, setAnnulerLot] = useState<{
    lignes: LigneCommande[];
    vider: () => void;
  } | null>(null);

  const corps = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      action: "liste_page",
      ...(q ? { recherche: q } : { debut: periode.debut, fin: periode.fin }),
      ...(statuts.length ? { statuts } : {}),
      ...(filtres.mode ? { mode: filtres.mode } : {}),
      ...(filtres.moyen ? { moyen: filtres.moyen } : {}),
      ...(filtres.paiement ? { paiements: [filtres.paiement] } : {}),
      ...(filtres.en_retard ? { en_retard: true } : {}),
      ...(filtres.remboursement
        ? { remboursement: filtres.remboursement }
        : {}),
      ...(filtres.avec_note ? { avec_note: true } : {}),
      ...(filtres.avec_reclamation ? { avec_reclamation: true } : {}),
      ...(filtres.service ? { service: filtres.service } : {}),
      ...(filtres.zone ? { zone: Number(filtres.zone) } : {}),
      ...(filtres.livreur ? { livreur: filtres.livreur } : {}),
      ...(montantMin ? { montant_min: montantMin } : {}),
      ...(montantMax ? { montant_max: montantMax } : {}),
      tri: triServeur(tri),
      page,
      par_page: PAR_PAGE,
      ...extra,
    }),
    [q, periode, statuts, filtres, tri, page, montantMin, montantMax],
  );

  // Relecture du kit : la dernière demande gagne (PR #72), le minuteur ne double jamais une requête.
  // Toutes les 15 s seulement si la liste montre aujourd'hui (service en cours) ; sinon une fois par heure.
  const enDirect =
    !q && periode.debut <= aujourdhui && periode.fin >= aujourdhui;
  const corpsCourant = corps();
  const {
    donnees,
    erreur,
    chargement,
    recharger: charger,
  } = useRelecture<Page>(
    async () => {
      const r = await poster("/api/gestion/commandes", corpsCourant);
      if (!r.ok)
        throw new ErreurLisible(
          String(r.donnees.erreur ?? "La liste n'a pas pu être chargée."),
        );
      return r.donnees as unknown as Page;
    },
    [corpsCourant],
    {
      intervalleMs: enDirect ? RELECTURE_MS : 3_600_000,
      messageErreur: "La liste n'a pas pu être chargée. Vérifiez le réseau.",
    },
  );

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

  // Réimprimer plusieurs commandes : une à une, comme sur la tablette ; le résultat est dit en une phrase.
  async function reimprimerLot(lignes: LigneCommande[], vider: () => void) {
    let ok = 0;
    for (const l of lignes) {
      const r = await poster("/api/gestion/commandes", {
        action: "reimprimer",
        id: l.id,
      });
      if (r.ok) ok += 1;
    }
    const rate = lignes.length - ok;
    notifier({
      texte: `${ok} commande${ok > 1 ? "s" : ""} réimprimée${ok > 1 ? "s" : ""}.${rate ? ` ${rate} sans ticket à renvoyer.` : ""}`,
      ton: ok ? "succes" : "erreur",
    });
    vider();
    charger();
  }

  // Filtres repliés au départ, période comprise : la liste reste visible (retour du chef de produit).
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const multiJour = !!q || periode.debut !== periode.fin;
  const colonnes = useMemo(
    () => (multiJour ? [COLONNES[0], JOUR, ...COLONNES.slice(1)] : COLONNES),
    [multiJour],
  );
  const raccourci = raccourciDe(periode, aujourdhui);
  const periodeTexte = q
    ? "90 derniers jours"
    : raccourci
      ? (RACCOURCIS_PERIODE.find((r) => r.cle === raccourci)?.libelle ?? "")
      : `du ${jourCourt(`${periode.debut}T12:00:00Z`)} au ${jourCourt(`${periode.fin}T12:00:00Z`)}`;
  const nbFiltres = Object.values(filtres).filter(
    (v) => v !== "" && v !== false,
  ).length;

  // Filtres lus dans l'adresse, une fois, pour qu'une alerte de l'accueil ouvre la liste déjà filtrée.
  // Seulement des états et des périodes : une recherche (nom, téléphone) n'y passe jamais.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search);
    if (![...a.keys()].length) return;
    // Arrivée depuis une alerte : les filtres s'ouvrent pour montrer ce qui est déjà choisi.
    setFiltresOuverts(true);
    const statutsAdresse = (a.get("statut") ?? "")
      .split(",")
      .filter((x) => (ORDRE_STATUTS as readonly string[]).includes(x));
    if (statutsAdresse.length) setStatuts(statutsAdresse);
    const r = a.get("periode");
    if (r && RACCOURCIS_PERIODE.some((x) => x.cle === r))
      setPeriode(periodeDe(r as CleRaccourciPeriode, aujourdhui));
    // Période personnalisée (alertes de l'accueil) : du et au en AAAA-MM-JJ, au plus un an, sinon ignorée.
    const du = a.get("du");
    const au = a.get("au") ?? du;
    const jour = /^\d{4}-\d{2}-\d{2}$/;
    if (
      du &&
      au &&
      jour.test(du) &&
      jour.test(au) &&
      du <= au &&
      Date.parse(au) - Date.parse(du) <= 366 * 86_400_000
    )
      setPeriode({ debut: du, fin: au });
    setFiltres((f) => ({
      ...f,
      ...(["fait", "en_cours", "echec"].includes(a.get("remboursement") ?? "")
        ? { remboursement: a.get("remboursement")! }
        : {}),
      ...(["en_ligne", "comptoir"].includes(a.get("moyen") ?? "")
        ? { moyen: a.get("moyen")! }
        : {}),
      ...(["paye", "a_encaisser_retrait", "encaisse", "rembourse"].includes(
        a.get("paiement") ?? "",
      )
        ? { paiement: a.get("paiement")! }
        : {}),
      ...(["midi", "soir"].includes(a.get("service") ?? "")
        ? { service: a.get("service")! }
        : {}),
      ...(["livraison", "retrait"].includes(a.get("mode") ?? "")
        ? { mode: a.get("mode")! }
        : {}),
      ...(a.get("en_retard") === "1" ? { en_retard: true } : {}),
      ...(a.get("avec_reclamation") === "1" ? { avec_reclamation: true } : {}),
      ...(a.get("avec_note") === "1" ? { avec_note: true } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        colonnes={colonnes}
        lignes={donnees?.lignes ?? null}
        cleLigne={(l) => l.id}
        chargement={chargement && donnees !== null}
        erreur={erreur}
        onReessayer={charger}
        tri={tri}
        onTri={(t) => {
          setTri(triPermis(t));
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
            <details
              className="bo-filtres-plus"
              open={filtresOuverts}
              onToggle={(e) =>
                setFiltresOuverts((e.target as HTMLDetailsElement).open)
              }
            >
              <summary className="bo-bouton bo-bouton-second bo-bouton-petit">
                Filtres : {periodeTexte}
                {nbFiltres ? `, ${nbFiltres} de plus` : ""}
              </summary>
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
                  Service
                  <select
                    value={filtres.service}
                    onChange={(e) => filtrer("service", e.target.value)}
                  >
                    <option value="">Midi et soir</option>
                    <option value="midi">Midi</option>
                    <option value="soir">Soir</option>
                  </select>
                </label>
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
                  Moyen de paiement
                  <select
                    value={filtres.moyen}
                    onChange={(e) => filtrer("moyen", e.target.value)}
                  >
                    <option value="">Tous</option>
                    <option value="en_ligne">En ligne</option>
                    <option value="comptoir">Au comptoir</option>
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
                <label>
                  Zone
                  <select
                    value={filtres.zone}
                    onChange={(e) => filtrer("zone", e.target.value)}
                  >
                    <option value="">Toutes</option>
                    {options.zones.map((z) => (
                      <option key={z.numero} value={String(z.numero)}>
                        {z.nom}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Livreur
                  <select
                    value={filtres.livreur}
                    onChange={(e) => filtrer("livreur", e.target.value)}
                  >
                    <option value="">Tous</option>
                    {options.livreurs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nom}
                        {l.actif ? "" : " (ancien)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Total dès (CHF)
                  <input
                    className="bo-filtre-montant"
                    inputMode="decimal"
                    value={filtres.montant_min}
                    onChange={(e) => filtrer("montant_min", e.target.value)}
                  />
                </label>
                <label>
                  Total jusqu&apos;à (CHF)
                  <input
                    className="bo-filtre-montant"
                    inputMode="decimal"
                    value={filtres.montant_max}
                    onChange={(e) => filtrer("montant_max", e.target.value)}
                  />
                </label>
                <label className="bo-case">
                  <input
                    type="checkbox"
                    checked={filtres.en_retard}
                    onChange={(e) => filtrer("en_retard", e.target.checked)}
                  />{" "}
                  En retard
                </label>
                <label>
                  Remboursement
                  <select
                    value={filtres.remboursement}
                    onChange={(e) => filtrer("remboursement", e.target.value)}
                  >
                    <option value="">Peu importe</option>
                    <option value="fait">Fait</option>
                    <option value="en_cours">En cours</option>
                    <option value="echec">En échec</option>
                  </select>
                </label>
                <label className="bo-case">
                  <input
                    type="checkbox"
                    checked={filtres.avec_note}
                    onChange={(e) => filtrer("avec_note", e.target.checked)}
                  />{" "}
                  Avec note
                </label>
                <label className="bo-case">
                  <input
                    type="checkbox"
                    checked={filtres.avec_reclamation}
                    onChange={(e) =>
                      filtrer("avec_reclamation", e.target.checked)
                    }
                  />{" "}
                  Avec réclamation ouverte
                </label>
              </div>
            </details>
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
        }
        onOuvrir={(l) =>
          setOuverte({
            id: l.id,
            titre: `Commande ${l.numero}`,
            sousTitre: `${l.client_prenom} ${l.client_nom}, ${MODE[l.mode].toLowerCase()}`,
          })
        }
        csv={{ toutes }}
        actionsLot={(cles, vider) => {
          const choisies = (donnees?.lignes ?? []).filter((l) =>
            cles.includes(l.id),
          );
          const aAnnuler = choisies.filter((l) => ANNULABLE.includes(l.statut));
          const aImprimer = choisies.filter((l) =>
            IMPRIMABLE.includes(l.statut),
          );
          return (
            <>
              {gerant && (
                <button
                  type="button"
                  className="bo-bouton bo-bouton-second bo-bouton-petit"
                  disabled={aImprimer.length === 0}
                  onClick={() => reimprimerLot(aImprimer, vider)}
                >
                  Réimprimer ({aImprimer.length})
                </button>
              )}
              {peutAnnuler && (
                <button
                  type="button"
                  className="bo-bouton bo-bouton-second bo-bouton-petit"
                  disabled={aAnnuler.length === 0}
                  onClick={() => setAnnulerLot({ lignes: aAnnuler, vider })}
                >
                  Annuler… ({aAnnuler.length})
                </button>
              )}
            </>
          );
        }}
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

      {annulerLot && (
        <PanneauLateral
          titre={`Annuler ${annulerLot.lignes.length} commande${annulerLot.lignes.length > 1 ? "s" : ""}`}
          sousTitre={annulerLot.lignes.map((l) => `n° ${l.numero}`).join(", ")}
          onFermer={() => setAnnulerLot(null)}
        >
          <AnnulerLot
            lignes={annulerLot.lignes}
            fait={() => {
              annulerLot.vider();
              setAnnulerLot(null);
              charger();
            }}
          />
        </PanneauLateral>
      )}

      {ouverte && (
        <PanneauLateral
          large
          titre={ouverte.titre}
          sousTitre={ouverte.sousTitre}
          onFermer={() => setOuverte(null)}
        >
          <FicheCommande id={ouverte.id} onChange={charger} />
        </PanneauLateral>
      )}
    </div>
  );
}
