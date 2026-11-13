// Validation des disponibilités et des ruptures planifiées saisies au back-office. La base revérifie tout
// (regler_disponibilite, planifier_rupture) ; ici, on refuse tôt ce qui est illisible.
import type { Dispo } from "@/lib/disponibilite";
import { ajouterJours } from "@/lib/service";

type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

// Une rupture planifiée va d'aujourd'hui à 60 jours au plus (même borne que la base).
export const RUPTURE_JOURS_MAX = 60;

export function champsDisponibilite(v: unknown): Resultat<Dispo> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Disponibilités illisibles." };
  const o = v as Record<string, unknown>;
  const service = o.service ?? null;
  const mode = o.mode ?? null;
  if (service !== null && service !== "midi" && service !== "soir") return { ok: false, erreur: "Service inconnu." };
  if (mode !== null && mode !== "livraison" && mode !== "retrait") return { ok: false, erreur: "Mode inconnu." };
  let jours: number[] | null = null;
  if (o.jours !== null && o.jours !== undefined) {
    if (!Array.isArray(o.jours) || o.jours.some((j) => !Number.isInteger(j) || j < 1 || j > 7)) return { ok: false, erreur: "Jours illisibles." };
    jours = [...new Set(o.jours as number[])].sort((a, b) => a - b);
    if (jours.length === 0) return { ok: false, erreur: "Cochez au moins un jour." };
    if (jours.length === 7) jours = null;
  }
  return { ok: true, valeur: { service, mode, jours } };
}

// Date de fin d'une rupture (comprise), ou null pour remettre le plat en vente.
export function dateRupture(v: unknown, aujourdhui: string): Resultat<string | null> {
  if (v === null) return { ok: true, valeur: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) {
    return { ok: false, erreur: "Date illisible." };
  }
  if (v < aujourdhui || v > ajouterJours(aujourdhui, RUPTURE_JOURS_MAX)) {
    return { ok: false, erreur: `Date de retour : d'aujourd'hui à ${RUPTURE_JOURS_MAX} jours.` };
  }
  return { ok: true, valeur: v };
}
