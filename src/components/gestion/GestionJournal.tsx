"use client";

import { useCallback, useEffect, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";

// Journal des modifications (déplacé tel quel depuis BackOffice.tsx, vague 3).
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
    default:
      return `${e.objet} ${e.cle}`;
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

const ROLE: Record<string, string> = { service: "tablette", gerant: "tablette et back-office", livreur: "livreur" };

function jourCourt(d: unknown): string {
  return jourTexte(String(d).slice(0, 10));
}

function resume(e: Entree): string {
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
    if (!e.avant || av.actif === false) return `Ajouté : ${ap.nom}, accès ${ROLE[ap.role ?? ""] ?? ap.role}`;
    if (ap.actif === false) return `Retiré : ${av.nom}`;
    const ch = [av.nom !== ap.nom ? `nom ${av.nom} → ${ap.nom}` : "", av.role !== ap.role ? `accès ${ROLE[av.role ?? ""]} → ${ROLE[ap.role ?? ""]}` : ""].filter(Boolean);
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

export function GestionJournal() {
  const [entrees, setEntrees] = useState<Entree[] | null>(null);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(async () => {
    const r = await fetch("/api/gestion/journal", { cache: "no-store" }).catch(() => null);
    setEntrees(r?.ok ? await r.json() : []);
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  // Retour arrière (G11) : la base refuse si la valeur a changé depuis.
  async function annuler(id: number) {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/journal", { action: "annuler", id });
    setMessage({ ok: r.ok, texte: String(r.donnees.message ?? r.donnees.erreur ?? "Pas annulé.") });
    setConfirmer(null);
    await charger();
    setEnvoi(false);
  }

  if (!entrees) return <p className="aide">Chargement…</p>;
  if (entrees.length === 0) return <p className="aide">Aucune modification pour l&apos;instant.</p>;
  return (
    <section className="ges-bloc">
      <h2>Journal des modifications</h2>
      <p className="aide">Les 200 dernières. « Annuler » remet l&apos;ancienne valeur, si rien n&apos;a changé depuis.</p>
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
      <ul className="ges-plats ges-journal-liste">
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
    </section>
  );
}
