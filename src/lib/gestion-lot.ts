// Validation du changement de prix en lot saisi au back-office. La base revérifie tout (prix_en_lot) et
// calcule elle-même les nouveaux prix à partir des siens : ici, on ne fait que refuser l'illisible.
type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

export type PrixEnLot = {
  categorie?: string;
  slugs?: string[];
  regle: "fixe" | "pourcentage" | "montant";
  valeur?: number;
  prix?: Record<string, number>;
  arrondi: 5 | 10 | 50 | 100;
  prix_valide: boolean;
};

const SLUG = /^[a-z0-9-]{1,80}$/;

export function champsPrixEnLot(v: unknown): Resultat<PrixEnLot> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Changement illisible." };
  const o = v as Record<string, unknown>;
  const regle = o.regle;
  if (regle !== "fixe" && regle !== "pourcentage" && regle !== "montant") return { ok: false, erreur: "Règle inconnue." };
  const arrondi = o.arrondi ?? 10;
  if (arrondi !== 5 && arrondi !== 10 && arrondi !== 50 && arrondi !== 100) return { ok: false, erreur: "Arrondi : 5, 10, 50 ou 100 centimes." };
  const r: PrixEnLot = { regle, arrondi, prix_valide: o.prix_valide === true };
  if (o.categorie !== undefined) {
    if (typeof o.categorie !== "string" || !SLUG.test(o.categorie)) return { ok: false, erreur: "Catégorie inconnue." };
    r.categorie = o.categorie;
  } else if (o.slugs !== undefined) {
    if (!Array.isArray(o.slugs) || o.slugs.length === 0 || o.slugs.length > 300 || o.slugs.some((s) => typeof s !== "string" || !SLUG.test(s))) {
      return { ok: false, erreur: "Liste de plats invalide." };
    }
    r.slugs = o.slugs as string[];
  } else if (regle !== "fixe") {
    return { ok: false, erreur: "Choisissez une catégorie ou des plats." };
  }
  if (regle === "fixe") {
    const prix = o.prix;
    if (!prix || typeof prix !== "object" || Array.isArray(prix)) return { ok: false, erreur: "Prix illisibles." };
    const entrees = Object.entries(prix as Record<string, unknown>);
    if (entrees.length === 0 || entrees.length > 300) return { ok: false, erreur: "Prix illisibles." };
    for (const [s, c] of entrees) {
      if (!SLUG.test(s) || !Number.isInteger(c) || (c as number) < 0) return { ok: false, erreur: "Prix illisibles." };
    }
    r.prix = prix as Record<string, number>;
  } else {
    const max = regle === "pourcentage" ? 5000 : 10000;
    if (!Number.isInteger(o.valeur) || o.valeur === 0 || Math.abs(o.valeur as number) > max) {
      return { ok: false, erreur: regle === "pourcentage" ? "Pourcentage : de -50 à +50 %." : "Montant : de -100 à +100 francs." };
    }
    r.valeur = o.valeur as number;
  }
  return { ok: true, valeur: r };
}
