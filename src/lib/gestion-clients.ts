// Contrôle des demandes de la rubrique Clients du back-office (vague 3, bo-commandes). Fonctions pures,
// testées sans base. Un client est un e-mail : il voyage dans le corps d'un POST, jamais dans une adresse.
import type { Resultat } from "@/lib/gestion";
import { texteNote } from "@/lib/gestion-commandes";

export const TRIS_CLIENTS = ["derniere", "depense", "commandes", "nom"] as const;
export const MARQUES = ["surveiller", "bloque"] as const;

const vide = (v: unknown) => v === undefined || v === null || v === "";
const entier = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : NaN);

// E-mail d'une commande passée : en minuscules, de forme simple. Plus large que emailNormalise (validation.ts)
// pour retrouver aussi les commandes passées avant un durcissement de la règle.
export function emailClient(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 5 && e.length <= 120 && /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}

export function filtresClients(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  const p: Record<string, unknown> = {};
  if (!vide(c.recherche)) {
    if (typeof c.recherche !== "string") return { ok: false, erreur: "Recherche illisible." };
    const q = c.recherche.trim().replace(/\s+/g, " ").slice(0, 60);
    if (q) p.recherche = q;
  }
  if (!vide(c.tri)) {
    if (!(TRIS_CLIENTS as readonly unknown[]).includes(c.tri)) return { ok: false, erreur: "Tri inconnu." };
    p.tri = c.tri;
  }
  if (!vide(c.marque)) {
    if (!(MARQUES as readonly unknown[]).includes(c.marque)) return { ok: false, erreur: "Marque inconnue." };
    p.marque = c.marque;
  }
  if (!vide(c.avec_compte) && c.avec_compte !== false) {
    if (c.avec_compte !== true) return { ok: false, erreur: "Filtre illisible." };
    p.avec_compte = true;
  }
  if (!vide(c.inactif_jours)) {
    const j = entier(c.inactif_jours);
    if (!Number.isInteger(j) || j < 1 || j > 3650) return { ok: false, erreur: "Nombre de jours invalide." };
    p.inactif_jours = j;
  }
  for (const [cle, min, max] of [["page", 1, 10_000], ["par_page", 10, 100]] as const) {
    if (vide(c[cle])) continue;
    const v = entier(c[cle]);
    if (!Number.isInteger(v) || v < min || v > max) return { ok: false, erreur: "Page invalide." };
    p[cle] = v;
  }
  return { ok: true, valeur: p };
}

export function motifMarque(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().replace(/\s+/g, " ");
  const n = Array.from(m).length;
  return n >= 3 && n <= 200 ? m : null;
}

export { texteNote };
