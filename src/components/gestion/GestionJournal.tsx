"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { nomObjet, type FiltresJournal, type PageJournal, type Recherche } from "@/lib/journal";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";
import "./journal.css";

// Journal des modifications : filtres par période, auteur, objet et recherche, page par page (vague 3, bo-pilotage).
type Entree = {
  id: number;
  personnel_nom: string;
  objet: string;
  cle: string;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  le: string;
  annule_par?: number | null;
};

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const chf = (c: unknown) => `CHF ${(Number(c ?? 0) / 100).toFixed(2)}`;
const heure = (v: unknown) => (typeof v === "string" && v ? heureDe(v) : "");

// Objets ajoutés pendant la vague 3 par d'autres rubriques (contrats : docs/coup-de-feu.md, docs/zones-services.md,
// docs/livreurs.md, docs/pilotage.md). Rien de reconnu : null, et le résumé général prend le relais.
function resumeVague3(e: Entree): string | null {
  const a = e.apres as Record<string, unknown> | unknown[] | null;
  switch (e.objet) {
    case "coup_de_feu": {
      if (e.cle === "finir") return e.personnel_nom === "Fin automatique" ? "Fini à l'heure prévue" : "Fini";
      const x = (a ?? {}) as { jusqua?: string; applique?: Record<string, unknown> };
      const ap = x.applique ?? {};
      const parts = [
        ap.retard_minutes ? `+${ap.retard_minutes} min` : "",
        ap.livraison_fermee ? "livraison fermée" : "",
        ap.capacite_livraisons_par_creneau !== undefined ? `${ap.capacite_livraisons_par_creneau} livraisons par créneau` : "",
        ap.capacite_retraits_par_creneau !== undefined ? `${ap.capacite_retraits_par_creneau} retraits par créneau` : "",
      ].filter(Boolean);
      return `Lancé${parts.length ? ` : ${parts.join(", ")}` : ""}${x.jusqua ? `, jusqu'à ${heure(x.jusqua)}` : ""}`;
    }
    case "zone_services": {
      const v = Array.isArray(a) ? a : [];
      const t = v.includes("midi") && v.includes("soir") ? "midi et soir" : v.includes("soir") ? "le soir seulement" : v.includes("midi") ? "le midi seulement" : "aucun service";
      return `Zone ${e.cle} : ${t}`;
    }
    case "zone_fermeture": {
      if (!a) return `Zone ${e.cle} rouverte`;
      const x = a as { jusqua?: string; motif?: string };
      return `Zone ${e.cle} fermée${x.jusqua ? ` jusqu'à ${heure(x.jusqua)}` : ""}${x.motif ? ` : ${x.motif}` : ""}`;
    }
    case "livreur_semaine": {
      const v = (Array.isArray(a) ? a : []) as { jour?: number; service?: string }[];
      return v.length ? `${e.cle} : ${v.map((j) => `${JOURS[j.jour ?? 0] ?? ""} ${j.service ?? ""}`.trim()).join(", ")}` : `${e.cle} : aucun service`;
    }
    case "livreur_jour": {
      if (!a) return `${e.cle} : comme d'habitude`;
      const x = a as { jour?: string; service?: string; present?: boolean; motif?: string };
      const quand = `${x.jour ? jourCourt(x.jour) : ""} ${x.service ?? ""}`.trim();
      return x.present ? `${e.cle} en plus ${quand}` : `${e.cle} absent ${quand}${x.motif ? ` : ${x.motif}` : ""}`;
    }
    case "cloture": {
      const x = (a ?? {}) as Record<string, unknown>;
      const compte = x.especes_comptees_centimes === null && x.carte_comptoir_centimes === null
        ? "rien compté"
        : `compté ${chf(Number(x.especes_comptees_centimes ?? 0) + Number(x.carte_comptoir_centimes ?? 0))}, écart ${chf(x.ecart_centimes)}`;
      return `Jour du ${jourCourt(e.cle)} : attendu au comptoir ${chf(x.attendu_comptoir_centimes)}, ${compte}${e.avant ? " (reclôturé)" : ""}`;
    }
    default:
      return null;
  }
}

// Ce qui se remet depuis le journal (audit du gérant, G11), comme dans annuler_journal en base.
const REGLAGES_ANNULABLES = ["plafond_comptoir_centimes", "capacite_livraisons_par_creneau", "capacite_retraits_par_creneau", "alerte_acceptation_minutes"];
function annulable(e: Entree): boolean {
  if (e.annule_par) return false;
  if (e.objet === "reglage") return REGLAGES_ANNULABLES.includes(e.cle) && e.avant !== null;
  return ["zone", "horaire", "plat", "option", "fermeture", "ouverture", "zone_npa"].includes(e.objet);
}

const REGLAGES: Record<string, (v: unknown) => string> = {
  plafond_comptoir_centimes: (v) => `Paiement au comptoir jusqu'à CHF ${(Number(v) / 100).toFixed(2)}`,
  capacite_livraisons_par_creneau: (v) => `${v} livraisons par créneau`,
  capacite_retraits_par_creneau: (v) => `${v} retraits par créneau`,
  alerte_acceptation_minutes: (v) => `Alerte après ${v} min`,
};

function quoi(e: Entree): string {
  switch (e.objet) {
    case "plat":
      return `Plat ${String((e.apres ?? e.avant)?.nom ?? e.cle)}`;
    case "plat_ajoute":
      return `Plat ajouté ${String(e.apres?.nom ?? e.cle)}`;
    case "plat_archive":
      return `Plat ${e.cle}`;
    case "plat_du_jour":
      return `Plat du jour ${String(e.apres?.nom ?? e.cle)}`;
    case "categorie":
      return `Catégorie ${e.cle}`;
    case "photo":
      return `Photo ${e.cle}`;
    case "option":
      return `Supplément ${e.cle.split("/").slice(1).join("/")}`;
    case "zone":
      return `Zone ${e.cle}`;
    case "zone_npa":
      return `Commune ${e.cle}`;
    case "horaire":
      return "Horaire";
    case "fermeture":
      return "Fermeture";
    case "ouverture":
      return "Ouverture exceptionnelle";
    case "reglage":
      return "Réglage";
    case "personnel":
      return `Équipe, ${e.cle}`;
    case "remboursement":
      return `Commande ${e.cle}`;
    case "import":
      return "Import du tableau";
    case "imprimante":
      return `Imprimante ${e.cle}`;
    case "zone_services":
    case "zone_fermeture":
      return `${nomObjet(e.objet)}, zone ${e.cle}`;
    case "cloture":
      return "Clôture du jour";
    default:
      return `${nomObjet(e.objet)}${e.cle ? `, ${e.cle}` : ""}`;
  }
}

const LIBELLES: Record<string, string> = {
  nom: "Nom",
  description: "Description",
  prix_centimes: "Prix",
  prix_a_valider: "Prix à valider",
  commandable: "Commandable",
  station: "Station",
  photo: "Photo",
  provenance: "Provenance",
  provenances_a_fournir: "Provenances à fournir",
  allergenes: "Allergènes",
  categorie_id: "Catégorie",
  groupes: "Options",
  archive_le: "Archivé le",
  jour_service: "Service",
  actif: "Proposé",
  frais_centimes: "Frais",
  minimum_centimes: "Minimum",
  delai_min: "Délai de",
  delai_max: "Délai à",
  active: "Zone ouverte",
  proposition: "Proposition",
  premiere_heure: "Première heure",
  derniere_heure: "Dernière heure",
  derniere_commande: "Dernière commande",
  derniere_commande_pizzas: "Dernière pizza",
};

function valeurLisible(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5);
  if (cle.endsWith("_centimes") && typeof v === "number") return (v / 100).toFixed(2);
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.join(", ") || "vide";
  return String(v);
}

const ROLE: Record<string, string> = { service: "tablette", gerant: "tablette et back-office", livreur: "livreur", responsable: "responsable de service" };
// Un rôle ajouté plus tard sans libellé s'affiche sous son nom, jamais « undefined ».
const role = (r: string | undefined) => (r ? (ROLE[r] ?? r) : "aucun");

function jourCourt(d: unknown): string {
  return jourTexte(String(d).slice(0, 10));
}

function resume(e: Entree): string {
  const v3 = resumeVague3(e);
  if (v3 !== null) return v3;
  if (e.objet === "reglage") {
    const f = REGLAGES[e.cle] ?? ((v: unknown) => String(v));
    return `${e.avant === null ? "vide" : f(e.avant)} → ${f(e.apres)}`;
  }
  if (e.objet === "fermeture" || e.objet === "ouverture") {
    const x = (e.apres ?? e.avant ?? {}) as { debut?: string; fin?: string; jour?: string; service?: string | null; motif?: string };
    const quand = x.jour
      ? `le ${jourCourt(x.jour)}, ${x.service === "midi" ? "midi" : "soir"}`
      : x.service
        ? `le ${jourCourt(x.debut)}, ${x.service}`
        : `du ${jourCourt(x.debut)} au ${jourCourt(x.fin)}`;
    return `${e.apres ? "Ajout" : "Suppression"} : ${quand}, ${x.motif ?? ""}`;
  }
  if (e.objet === "zone_npa") {
    const av = e.avant as { zone_numero?: number } | null;
    const ap = e.apres as { zone_numero?: number } | null;
    if (!av) return `Ajoutée à la zone ${ap?.zone_numero}`;
    if (!ap) return `Retirée de la zone ${av.zone_numero}`;
    return `Zone ${av.zone_numero} → zone ${ap.zone_numero}`;
  }
  if (e.objet === "plat_archive") return e.apres?.archive ? "Archivé" : "Remis à la carte";
  if (e.objet === "remboursement" && e.apres) {
    const a = e.apres as { montant_centimes?: number; motif?: string; moyen?: string };
    return `Commande ${e.cle} : CHF ${((a.montant_centimes ?? 0) / 100).toFixed(2)} remboursés${a.moyen === "especes" ? " en espèces" : ""}. ${a.motif ?? ""}`;
  }
  if (e.objet === "personnel") {
    const av = (e.avant ?? {}) as { nom?: string; role?: string; actif?: boolean };
    const ap = (e.apres ?? {}) as { nom?: string; role?: string; actif?: boolean; sessions_coupees?: number };
    if (ap.sessions_coupees !== undefined) return `Déconnecté de ${ap.sessions_coupees} appareil${ap.sessions_coupees > 1 ? "s" : ""}`;
    if (!e.avant || av.actif === false) return `Ajouté : ${ap.nom}, accès ${role(ap.role)}`;
    if (ap.actif === false) return `Retiré : ${av.nom}`;
    const ch = [av.nom !== ap.nom ? `nom ${av.nom} → ${ap.nom}` : "", av.role !== ap.role ? `accès ${role(av.role)} → ${role(ap.role)}` : ""].filter(Boolean);
    return ch.length ? ch.join(" ; ") : "Enregistré sans changement";
  }
  if (!e.avant || !e.apres || Array.isArray(e.avant) || Array.isArray(e.apres)) {
    if (e.objet === "import") return `Import : ${JSON.stringify(e.apres)}`;
    if (!e.avant) return "Ajout";
    if (!e.apres) return "Suppression";
    return `${JSON.stringify(e.avant)} → ${JSON.stringify(e.apres)}`;
  }
  // « Proposition » passe à non à chaque enregistrement : sans intérêt pour le gérant.
  const cles = Object.keys(e.apres).filter((k) => k !== "proposition" && JSON.stringify(e.avant![k]) !== JSON.stringify(e.apres![k]));
  return cles.length
    ? cles.map((k) => `${LIBELLES[k] ?? k} : ${valeurLisible(k, e.avant![k])} → ${valeurLisible(k, e.apres![k])}`).join(" ; ")
    : "Enregistré sans changement";
}

const LIMITE = 100;
const SANS_FILTRE: Recherche = {};

export function GestionJournal() {
  const [entrees, setEntrees] = useState<Entree[] | null>(null);
  const [suivant, setSuivant] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtres, setFiltres] = useState<FiltresJournal>({ auteurs: [], objets: [] });
  const [saisie, setSaisie] = useState<Recherche>(SANS_FILTRE);
  const [actifs, setActifs] = useState<Recherche>(SANS_FILTRE);
  const [plus, setPlus] = useState(false);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Une réponse lente d'une ancienne recherche n'écrase pas la nouvelle.
  const demande = useRef(0);

  const charger = useCallback(async (r: Recherche) => {
    const n = ++demande.current;
    setErreur(null);
    const rep = await poster("/api/gestion/journal", { action: "chercher", ...r, limite: LIMITE });
    if (n !== demande.current) return;
    if (!rep.ok) {
      setErreur(String(rep.donnees.erreur ?? "Le journal ne répond pas."));
      setEntrees((e) => e ?? []);
      return;
    }
    const page = rep.donnees as unknown as PageJournal;
    setEntrees(page.entrees as Entree[]);
    setSuivant(page.suivant);
  }, []);

  useEffect(() => {
    charger(SANS_FILTRE);
    poster("/api/gestion/journal", { action: "filtres" }).then((r) => {
      if (r.ok) setFiltres(r.donnees as unknown as FiltresJournal);
    });
  }, [charger]);

  async function appliquer(r: Recherche) {
    setActifs(r);
    setEntrees(null);
    await charger(r);
  }

  async function suivantes() {
    if (suivant === null) return;
    setPlus(true);
    const n = demande.current;
    const rep = await poster("/api/gestion/journal", { action: "chercher", ...actifs, avant_id: suivant, limite: LIMITE });
    // Une nouvelle recherche lancée entre-temps : cette page ne la concerne pas.
    if (n !== demande.current) {
      setPlus(false);
      return;
    }
    if (rep.ok) {
      const page = rep.donnees as unknown as PageJournal;
      setEntrees((e) => [...(e ?? []), ...(page.entrees as Entree[])]);
      setSuivant(page.suivant);
    } else {
      setErreur(String(rep.donnees.erreur ?? "Le journal ne répond pas."));
    }
    setPlus(false);
  }

  // Retour arrière (G11) : la base refuse si la valeur a changé depuis.
  async function annuler(id: number) {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/journal", { action: "annuler", id });
    setMessage({ ok: r.ok, texte: String(r.donnees.message ?? r.donnees.erreur ?? "Pas annulé.") });
    setConfirmer(null);
    await charger(actifs);
    setEnvoi(false);
  }

  const filtre = Object.values(actifs).some(Boolean);
  const champ = (k: keyof Recherche) => (v: string) => setSaisie((s) => ({ ...s, [k]: v || undefined }));

  return (
    <section className="ges-bloc">
      <h2>Journal des modifications</h2>
      <p className="aide">Qui a changé quoi, et quand. « Annuler » remet l&apos;ancienne valeur, si rien n&apos;a changé depuis.</p>
      <form
        className="ges-filtres ges-journal-filtres"
        role="search"
        aria-label="Filtrer le journal"
        onSubmit={(ev) => {
          ev.preventDefault();
          appliquer(saisie);
        }}
      >
        <div className="champ">
          <label htmlFor="journal-recherche">Chercher</label>
          <input id="journal-recherche" type="search" maxLength={60} value={saisie.recherche ?? ""} placeholder="Plat, zone, montant, numéro…" onChange={(e) => champ("recherche")(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor="journal-objet">Quoi</label>
          <select id="journal-objet" value={saisie.objet ?? ""} onChange={(e) => champ("objet")(e.target.value)}>
            <option value="">Tout</option>
            {filtres.objets.map((o) => (
              <option key={o.objet} value={o.objet}>
                {nomObjet(o.objet)} ({o.lignes})
              </option>
            ))}
          </select>
        </div>
        <div className="champ">
          <label htmlFor="journal-auteur">Qui</label>
          <select id="journal-auteur" value={saisie.auteur ?? ""} onChange={(e) => champ("auteur")(e.target.value)}>
            <option value="">Tout le monde</option>
            {filtres.auteurs.map((a) => (
              <option key={a.nom} value={a.nom}>
                {a.nom} ({a.lignes})
              </option>
            ))}
          </select>
        </div>
        <div className="champ ges-journal-date">
          <label htmlFor="journal-debut">Du</label>
          <input id="journal-debut" type="date" value={saisie.debut ?? ""} onChange={(e) => champ("debut")(e.target.value)} />
        </div>
        <div className="champ ges-journal-date">
          <label htmlFor="journal-fin">Au</label>
          <input id="journal-fin" type="date" value={saisie.fin ?? ""} min={saisie.debut} onChange={(e) => champ("fin")(e.target.value)} />
        </div>
        <span className="boutons-ligne">
          <button type="submit" className="bouton-second">
            Filtrer
          </button>
          {filtre && (
            <button
              type="button"
              className="lien"
              onClick={() => {
                setSaisie(SANS_FILTRE);
                appliquer(SANS_FILTRE);
              }}
            >
              Tout afficher
            </button>
          )}
        </span>
      </form>
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}{" "}
          <button type="button" className="lien" onClick={() => charger(actifs)}>
            Réessayer
          </button>
        </p>
      )}
      {!entrees ? (
        <p className="aide" role="status">
          Chargement…
        </p>
      ) : entrees.length === 0 ? (
        !erreur && <p className="aide">{filtre ? "Aucune modification ne correspond à ces filtres." : "Aucune modification pour l'instant."}</p>
      ) : (
        <>
          <ul className="ges-plats ges-journal-liste" aria-label="Modifications, de la plus récente à la plus ancienne">
            {entrees.map((e) => (
              <li key={e.id} className={e.annule_par ? "ges-retire" : ""}>
                <p className="ges-journal-tete">
                  <strong>{quoi(e)}</strong>
                  <span>
                    {jourTexte(jourGeneveDe(e.le))}, {heureDe(e.le)}, {e.personnel_nom}
                  </span>
                </p>
                <p className="ges-diff">{resume(e)}</p>
                {e.annule_par ? (
                  <p className="aide">Annulée.</p>
                ) : (
                  annulable(e) &&
                  (confirmer === e.id ? (
                    <span className="boutons-ligne">
                      <button type="button" className="bouton-second" disabled={envoi} onClick={() => annuler(e.id)}>
                        Oui, remettre l&apos;ancienne valeur
                      </button>
                      <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                        Non
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="lien" onClick={() => setConfirmer(e.id)}>
                      Annuler
                    </button>
                  ))
                )}
              </li>
            ))}
          </ul>
          <p className="aide">
            {entrees.length} modification{entrees.length > 1 ? "s" : ""} affichée{entrees.length > 1 ? "s" : ""}.
            {suivant !== null && " "}
            {suivant !== null && (
              <button type="button" className="bouton-second" disabled={plus} onClick={suivantes}>
                {plus ? "Chargement…" : "Afficher les suivantes"}
              </button>
            )}
          </p>
        </>
      )}
    </section>
  );
}
