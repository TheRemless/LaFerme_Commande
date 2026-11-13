// Contrôle des demandes sur les réclamations (vague 3, bo-commandes). Fonctions pures, testées sans base.
import { dateValide, type Resultat } from "@/lib/gestion";

export const TYPES_RECLAMATION = ["retard", "manquant", "froid", "erreur", "qualite", "livraison", "autre"] as const;
export const SOURCES_EQUIPE = ["telephone", "sur_place", "email"] as const;
export const STATUTS_RECLAMATION = ["ouverte", "en_cours", "close"] as const;
export const GESTES = ["remboursement", "plat_offert", "aucun"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const vide = (v: unknown) => v === undefined || v === null || v === "";
const dans = <T extends string>(v: unknown, liste: readonly T[]): v is T => (liste as readonly unknown[]).includes(v);

// Texte libre : espaces resserrés, retours à la ligne gardés, longueur comptée comme Postgres.
export function texteLibre(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const n = Array.from(t).length;
  return n >= min && n <= max ? t : null;
}

export function nouvelleReclamation(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  if (!dans(c.type, TYPES_RECLAMATION)) return { ok: false, erreur: "Choisissez le type de réclamation." };
  const description = texteLibre(c.description, 3, 500);
  if (!description) return { ok: false, erreur: "Décrivez la réclamation (3 à 500 caractères)." };
  const p: Record<string, unknown> = { type: c.type, description };
  if (!vide(c.commande_id)) {
    if (typeof c.commande_id !== "string" || !UUID.test(c.commande_id)) return { ok: false, erreur: "Commande inconnue." };
    p.commande_id = c.commande_id;
    p.source = dans(c.source, SOURCES_EQUIPE) ? c.source : "telephone";
  } else {
    return { ok: false, erreur: "Choisissez la commande concernée." };
  }
  return { ok: true, valeur: p };
}

export function filtresReclamations(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  const p: Record<string, unknown> = {};
  for (const [cle, liste] of [["statuts", STATUTS_RECLAMATION], ["types", TYPES_RECLAMATION]] as const) {
    if (vide(c[cle])) continue;
    const v = c[cle];
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => dans(x, liste))) return { ok: false, erreur: "Filtre inconnu." };
    p[cle] = [...new Set(v)];
  }
  for (const cle of ["debut", "fin"] as const) {
    if (vide(c[cle])) continue;
    const d = dateValide(c[cle]);
    if (!d) return { ok: false, erreur: "Période invalide." };
    p[cle] = d;
  }
  if (typeof p.debut === "string" && typeof p.fin === "string" && p.fin < p.debut) return { ok: false, erreur: "Période invalide." };
  if (!vide(c.commande_id)) {
    if (typeof c.commande_id !== "string" || !UUID.test(c.commande_id)) return { ok: false, erreur: "Commande inconnue." };
    p.commande_id = c.commande_id;
  }
  for (const [cle, min, max] of [["page", 1, 10_000], ["par_page", 10, 100]] as const) {
    if (vide(c[cle])) continue;
    const v = typeof c[cle] === "number" ? (c[cle] as number) : NaN;
    if (!Number.isInteger(v) || v < min || v > max) return { ok: false, erreur: "Page invalide." };
    p[cle] = v;
  }
  return { ok: true, valeur: p };
}

export function suiviReclamation(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  const p: Record<string, unknown> = {};
  if (!vide(c.texte)) {
    const t = texteLibre(c.texte, 1, 500);
    if (!t) return { ok: false, erreur: "Message trop long (500 caractères au plus)." };
    p.texte = t;
  }
  if (!vide(c.statut)) {
    if (!dans(c.statut, STATUTS_RECLAMATION)) return { ok: false, erreur: "État inconnu." };
    p.statut = c.statut;
    if (c.statut === "close") {
      const r = texteLibre(c.resolution, 3, 500);
      if (!r) return { ok: false, erreur: "Écrivez comment la réclamation s'est réglée (3 caractères au moins)." };
      p.resolution = r;
    }
  }
  if (!p.texte && !p.statut) return { ok: false, erreur: "Rien à enregistrer." };
  return { ok: true, valeur: p };
}

export function gesteReclamation(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  if (!dans(c.geste, GESTES)) return { ok: false, erreur: "Geste inconnu." };
  if (c.geste === "remboursement") {
    if (typeof c.remboursement_id !== "string" || !UUID.test(c.remboursement_id)) return { ok: false, erreur: "Choisissez le remboursement fait." };
    return { ok: true, valeur: { geste: c.geste, remboursement_id: c.remboursement_id } };
  }
  const d = texteLibre(c.detail, 3, 200);
  if (!d) return { ok: false, erreur: c.geste === "plat_offert" ? "Dites ce qui est offert (3 à 200 caractères)." : "Dites pourquoi (3 à 200 caractères)." };
  return { ok: true, valeur: { geste: c.geste, detail: d } };
}
