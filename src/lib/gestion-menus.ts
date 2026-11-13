// Validation des menus et formules saisis au back-office. La base revérifie tout (creer_menu, modifier_menu,
// regler_etapes) ; aucun prix n'est écrit ici, le gérant les saisit.
import { centimes } from "@/lib/gestion";

type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };
const SLUG = /^[a-z0-9-]{1,80}$/;
const texte = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : null);

// Menu neuf (nom et prix exigés) ou modifié (chaque champ facultatif). prix : en francs (« 24.50 »).
export function champsMenu(v: unknown, neuf: boolean): Resultat<Record<string, unknown>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Menu illisible." };
  const o = v as Record<string, unknown>;
  const r: Record<string, unknown> = {};
  if (neuf || o.nom !== undefined) {
    const n = texte(o.nom);
    if (!n || n.length > 80) return { ok: false, erreur: "Indiquez le nom du menu (80 caractères au plus)." };
    r.nom = n;
  }
  if (o.description !== undefined) {
    const d = texte(o.description);
    if (d === null || d.length > 400) return { ok: false, erreur: "Description trop longue (400 caractères au plus)." };
    r.description = d;
  }
  if (neuf || o.prix !== undefined) {
    const c = centimes(o.prix);
    if (c === null || c === 0) return { ok: false, erreur: "Prix invalide : un montant en francs plus grand que zéro." };
    r.prix_centimes = c;
  }
  for (const k of ["prix_valide", "actif"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "boolean") return { ok: false, erreur: "Case illisible." };
    if (k === "actif" && neuf) continue; // un menu naît inactif
    r[k] = o[k];
  }
  return { ok: true, valeur: r };
}

export type EtapeSaisie = { nom: string; choix_min: number; choix_max: number; categorie: string | null; plats: { slug: string; supplement_centimes: number }[] };

// Étapes : six au plus ; chaque étape a un nom, un minimum et un maximum, une catégorie ou des plats.
export function etapesMenu(v: unknown): Resultat<EtapeSaisie[]> {
  if (!Array.isArray(v) || v.length > 6) return { ok: false, erreur: "Six étapes au plus." };
  const r: EtapeSaisie[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") return { ok: false, erreur: "Étape illisible." };
    const o = e as Record<string, unknown>;
    const nom = texte(o.nom);
    if (!nom || nom.length > 60) return { ok: false, erreur: "Chaque étape a un nom (60 caractères au plus)." };
    const min = o.choix_min ?? 1;
    const max = o.choix_max ?? 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) < 1 || (max as number) > 10 || (min as number) > (max as number)) {
      return { ok: false, erreur: `${nom} : minimum de 0 à 10, maximum de 1 à 10.` };
    }
    const categorie = o.categorie == null || o.categorie === "" ? null : o.categorie;
    if (categorie !== null && (typeof categorie !== "string" || !SLUG.test(categorie))) return { ok: false, erreur: `${nom} : catégorie inconnue.` };
    const plats = Array.isArray(o.plats) ? o.plats : [];
    if (plats.length > 100) return { ok: false, erreur: `${nom} : trop de plats.` };
    const liste: EtapeSaisie["plats"] = [];
    for (const p of plats) {
      const q = (p ?? {}) as Record<string, unknown>;
      if (typeof q.slug !== "string" || !SLUG.test(q.slug)) return { ok: false, erreur: `${nom} : plat inconnu.` };
      const sup = q.supplement === undefined || q.supplement === "" ? 0 : centimes(q.supplement);
      if (sup === null) return { ok: false, erreur: `${nom} : supplément illisible.` };
      liste.push({ slug: q.slug, supplement_centimes: sup });
    }
    if (categorie === null && liste.length === 0) return { ok: false, erreur: `${nom} : choisissez une catégorie ou des plats.` };
    r.push({ nom, choix_min: min as number, choix_max: max as number, categorie: categorie as string | null, plats: liste });
  }
  return { ok: true, valeur: r };
}
