// Contrôle de forme des données envoyées par le navigateur. Le fond (prix, options, zone, heure)
// est vérifié ensuite contre la base. Toute valeur absente ou douteuse rend null.
import { LIMITES, type LignePanier } from "@/lib/panier";
import type { Details } from "@/lib/adresse";
import type { Quand } from "@/lib/service";

const CLES_INTERDITES = new Set(["__proto__", "constructor", "prototype"]);

export function lignesValides(v: unknown): LignePanier[] | null {
  if (!Array.isArray(v) || v.length > LIMITES.lignes) return null;
  const lignes: LignePanier[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const l = x as Record<string, unknown>;
    if (typeof l.slug !== "string" || l.slug.length > 80 || typeof l.qte !== "number") return null;
    const choix: Record<string, string[]> = {};
    if (l.choix && typeof l.choix === "object") {
      for (const [g, noms] of Object.entries(l.choix as Record<string, unknown>)) {
        if (CLES_INTERDITES.has(g) || g.length > 80) return null;
        if (!Array.isArray(noms) || noms.length > 40 || noms.some((n) => typeof n !== "string" || n.length > 80)) return null;
        choix[g] = noms as string[];
      }
    }
    const retraits = Array.isArray(l.retraits) ? l.retraits : [];
    if (retraits.length > 20 || retraits.some((r) => typeof r !== "string" || r.length > 80)) return null;
    const note = typeof l.note === "string" ? l.note : "";
    if (note.length > 500) return null;
    lignes.push({ slug: l.slug, qte: l.qte, choix, retraits: retraits as string[], note });
  }
  return lignes;
}

export function quandValide(v: unknown): Quand {
  const q = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (q.type === "asap") return { type: "asap" };
  if (q.type === "creneau" && typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && Number.isInteger(q.minutes)) {
    return { type: "creneau", date: q.date, minutes: q.minutes as number };
  }
  return { type: "aucun" };
}

function texte(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return min === 0 ? "" : null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= min && t.length <= max ? t : null;
}

export type Client = { prenom: string; nom: string; telephone: string; email: string };

// E-mail sans espaces, en minuscules, de forme valable. Même règle pour la commande et le compte.
export function emailNormalise(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 5 && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

export function clientValide(v: unknown): Client | null {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const prenom = texte(c.prenom, 1, 60);
  const nom = texte(c.nom, 1, 60);
  const telephone = texte(c.telephone, 8, 20);
  const email = emailNormalise(c.email);
  if (!prenom || !nom || !telephone || !email) return null;
  if (!/^\+?[0-9 ().-]{8,20}$/.test(telephone) || (telephone.match(/\d/g) ?? []).length < 9) return null;
  return { prenom, nom, telephone, email };
}

export function detailsValides(v: unknown): Details | null {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sonnette = texte(d.sonnette, 1, 60);
  const etage = texte(d.etage, 0, 30);
  const code = texte(d.code, 0, 30);
  const instructions = texte(d.instructions, 0, 140);
  if (!sonnette || etage === null || code === null || instructions === null) return null;
  return { sonnette, etage, code, instructions };
}

export function cleValide(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null;
}
