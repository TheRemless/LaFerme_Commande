// Validation des groupes d'options saisis au back-office. La base revérifie tout (ajouter_groupe,
// modifier_groupe, regler_defauts, ordonner_options, renommer_option, lier_groupe).
type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

export type ChampsGroupe = { nom?: string; choix_min?: number; choix_max?: number };

const propre = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const n = v.replace(/\s+/g, " ").trim();
  return n && n.length <= max ? n : null;
};

// Groupe neuf (tout est exigé) ou modifié (chaque champ facultatif).
export function champsGroupe(v: unknown, neuf: boolean): Resultat<ChampsGroupe> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Groupe illisible." };
  const o = v as Record<string, unknown>;
  const r: ChampsGroupe = {};
  if (neuf || o.nom !== undefined) {
    const nom = propre(o.nom, 40);
    if (!nom) return { ok: false, erreur: "Indiquez le nom du groupe (40 caractères au plus)." };
    r.nom = nom;
  }
  for (const [cle, min, max] of [["choix_min", 0, 10], ["choix_max", 1, 20]] as const) {
    if (!neuf && o[cle] === undefined) continue;
    const n = o[cle];
    if (!Number.isInteger(n) || (n as number) < min || (n as number) > max) {
      return { ok: false, erreur: cle === "choix_min" ? "Minimum : de 0 à 10." : "Maximum : de 1 à 20." };
    }
    r[cle] = n as number;
  }
  if (r.choix_min !== undefined && r.choix_max !== undefined && r.choix_min > r.choix_max) {
    return { ok: false, erreur: "Le minimum dépasse le maximum." };
  }
  return { ok: true, valeur: r };
}

// Noms d'options (cochées d'avance, ordre) : 50 au plus, chacun de 60 caractères au plus.
export function nomsOptions(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 50 || v.some((n) => typeof n !== "string" || n.length === 0 || n.length > 60)) return null;
  return new Set(v).size === v.length ? (v as string[]) : null;
}

export function nomOption(v: unknown): string | null {
  return propre(v, 60);
}
