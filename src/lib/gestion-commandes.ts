// Contrôle des filtres de la liste des commandes du back-office (vague 3, bo-commandes). Fonction pure,
// testée sans base : seul ce qui est reconnu part vers liste_commandes_gestion, une valeur douteuse rend
// une erreur claire. Les montants arrivent en francs (« 20 », « 4.50 ») et partent en centimes.
import { centimes, dateValide, type Resultat } from "@/lib/gestion";

export const STATUTS_COMMANDE = ["nouvelle", "acceptee", "en_preparation", "prete", "partie", "terminee", "refusee"] as const;
export const STATUTS_PAIEMENT = ["paye", "encaisse", "a_encaisser_retrait", "rembourse", "echec", "en_attente"] as const;
export const TRIS = ["recent", "ancien", "heure", "montant", "numero"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const vide = (v: unknown) => v === undefined || v === null || v === "";

function liste<T extends string>(v: unknown, permis: readonly T[]): T[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > permis.length) return null;
  if (!v.every((x) => typeof x === "string" && (permis as readonly string[]).includes(x))) return null;
  return [...new Set(v as T[])];
}

export function filtresListe(c: Record<string, unknown>): Resultat<Record<string, unknown>> {
  const p: Record<string, unknown> = {};
  const debut = vide(c.debut) ? null : dateValide(c.debut);
  const fin = vide(c.fin) ? null : dateValide(c.fin);
  if ((!vide(c.debut) && !debut) || (!vide(c.fin) && !fin) || (debut && fin && fin < debut)) return { ok: false, erreur: "Période invalide." };
  if (debut && fin && Date.parse(fin) - Date.parse(debut) > 400 * 86_400_000) return { ok: false, erreur: "Période trop longue (un an au plus)." };
  if (debut) p.debut = debut;
  if (fin) p.fin = fin;

  if (!vide(c.recherche)) {
    if (typeof c.recherche !== "string") return { ok: false, erreur: "Recherche illisible." };
    const q = c.recherche.trim().replace(/\s+/g, " ").slice(0, 60);
    if (q) p.recherche = q;
  }
  if (!vide(c.statuts)) {
    const s = liste(c.statuts, STATUTS_COMMANDE);
    if (!s) return { ok: false, erreur: "Statut inconnu." };
    p.statuts = s;
  }
  if (!vide(c.paiements)) {
    const s = liste(c.paiements, STATUTS_PAIEMENT);
    if (!s) return { ok: false, erreur: "État de paiement inconnu." };
    p.paiements = s;
  }
  if (!vide(c.mode)) {
    if (c.mode !== "livraison" && c.mode !== "retrait") return { ok: false, erreur: "Mode inconnu." };
    p.mode = c.mode;
  }
  if (!vide(c.moyen)) {
    if (c.moyen !== "en_ligne" && c.moyen !== "comptoir") return { ok: false, erreur: "Moyen de paiement inconnu." };
    p.moyen = c.moyen;
  }
  if (!vide(c.zone)) {
    const z = typeof c.zone === "number" ? c.zone : typeof c.zone === "string" && /^\d{1,2}$/.test(c.zone.trim()) ? Number(c.zone) : NaN;
    if (!Number.isInteger(z) || z < 1 || z > 99) return { ok: false, erreur: "Zone inconnue." };
    p.zone = z;
  }
  if (!vide(c.livreur)) {
    if (typeof c.livreur !== "string" || !UUID.test(c.livreur)) return { ok: false, erreur: "Livreur inconnu." };
    p.livreur = c.livreur;
  }
  for (const [cle, nom] of [["montant_min", "minimum"], ["montant_max", "maximum"]] as const) {
    if (vide(c[cle])) continue;
    const m = centimes(c[cle], 100_000);
    if (m === null) return { ok: false, erreur: `Montant ${nom} invalide : un montant en francs, par exemple 20 ou 4.50.` };
    p[cle] = m;
  }
  if (typeof p.montant_min === "number" && typeof p.montant_max === "number" && p.montant_max < p.montant_min) {
    return { ok: false, erreur: "Le montant maximum est plus petit que le minimum." };
  }
  for (const cle of ["remboursee", "en_retard", "avec_note"] as const) {
    if (vide(c[cle]) || c[cle] === false) continue;
    if (c[cle] !== true) return { ok: false, erreur: "Filtre illisible." };
    p[cle] = true;
  }
  if (!vide(c.tri)) {
    if (!(TRIS as readonly unknown[]).includes(c.tri)) return { ok: false, erreur: "Tri inconnu." };
    p.tri = c.tri;
  }
  for (const [cle, min, max] of [["page", 1, 10_000], ["par_page", 10, 100]] as const) {
    if (vide(c[cle])) continue;
    const brut = c[cle];
    const v = typeof brut === "number" ? brut : typeof brut === "string" && /^\d{1,5}$/.test(brut) ? Number(brut) : NaN;
    if (!Number.isInteger(v) || v < min || v > max) return { ok: false, erreur: "Page invalide." };
    p[cle] = v;
  }
  return { ok: true, valeur: p };
}

// Note interne : texte libre lu par l'équipe seulement. Retours à la ligne gardés, espaces resserrés.
export function texteNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length >= 2 && t.length <= 500 ? t : null;
}
