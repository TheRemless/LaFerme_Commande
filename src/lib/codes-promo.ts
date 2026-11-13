// Codes promo : validation de la saisie du back-office et texte montré au client quand un code est refusé.
// La remise elle-même est calculée par la base (evaluer_code), jamais ici : aucun montant n'est écrit dans
// ce fichier. Le module est désactivé tant que le réglage codes_promo_actifs est faux.
import { prixChf } from "@/lib/prix";

type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

export type TypeCode = "pourcentage" | "montant" | "livraison";
export type RaisonRefus =
  | "desactive" | "inconnu" | "inactif" | "pas_commence" | "expire" | "minimum" | "plafond" | "deja_utilise" | "pas_premiere" | "retrait" | "client_inconnu";
export type EvaluationCode =
  | { ok: true; code: string; type: TypeCode; remise_centimes: number; a_verifier?: boolean }
  | { ok: false; raison: RaisonRefus; minimum_centimes?: number };

export const FORMAT_CODE = /^[A-Z0-9-]{3,20}$/;

// Ce que lit le client sous le champ « Code ». Un code épuisé (plafond) se dit « plus valable », sans
// dire combien de personnes l'ont utilisé. desactive : le site ne montre pas de champ du tout.
export function messageRefus(e: { raison: RaisonRefus; minimum_centimes?: number }): string | null {
  switch (e.raison) {
    case "desactive": return null;
    case "inconnu": return "Ce code n'existe pas. Vérifiez l'orthographe.";
    case "inactif": case "expire": case "plafond": return "Ce code n'est plus valable.";
    case "pas_commence": return "Ce code n'est pas encore valable.";
    case "minimum": return `Ce code vaut à partir de ${prixChf(e.minimum_centimes ?? 0)} de plats.`;
    case "deja_utilise": return "Vous avez déjà utilisé ce code.";
    case "pas_premiere": return "Ce code vaut pour une première commande.";
    case "retrait": return "Ce code vaut pour une livraison.";
    case "client_inconnu": return "Indiquez votre e-mail et votre téléphone pour utiliser ce code.";
  }
}

// Ce que tape le client : espaces retirés, majuscules. null s'il ne peut pas être un code.
export function codeSaisi(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.replace(/\s+/g, "").toUpperCase();
  return FORMAT_CODE.test(c) ? c : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const entier = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

// Code neuf (tout est exigé sauf dates, plafond, minimum) ou modifié (chaque champ facultatif).
export function champsCode(v: unknown, neuf: boolean): Resultat<Record<string, unknown>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Code illisible." };
  const o = v as Record<string, unknown>;
  const r: Record<string, unknown> = {};
  if (neuf) {
    const code = codeSaisi(o.code);
    if (!code) return { ok: false, erreur: "Code : 3 à 20 lettres, chiffres ou tirets." };
    r.code = code;
  }
  if (neuf || o.libelle !== undefined) {
    const l = typeof o.libelle === "string" ? o.libelle.replace(/\s+/g, " ").trim() : "";
    if (!l || l.length > 60) return { ok: false, erreur: "Indiquez le support (60 caractères au plus), par exemple « Flyer automne »." };
    r.libelle = l;
  }
  if (neuf || o.type !== undefined) {
    if (o.type !== "pourcentage" && o.type !== "montant" && o.type !== "livraison") return { ok: false, erreur: "Type inconnu." };
    r.type = o.type;
    if (o.type === "livraison") r.valeur = null;
    else if (o.type === "pourcentage" ? !entier(o.valeur, 1, 100) : !entier(o.valeur, 1)) {
      return { ok: false, erreur: o.type === "pourcentage" ? "Pourcentage : de 1 à 100." : "Montant en centimes, plus que zéro." };
    } else r.valeur = o.valeur;
  }
  if (o.minimum_centimes !== undefined) {
    if (!entier(o.minimum_centimes, 0)) return { ok: false, erreur: "Minimum illisible." };
    r.minimum_centimes = o.minimum_centimes;
  }
  for (const k of ["debut", "fin"] as const) {
    if (o[k] === undefined) continue;
    if (o[k] !== null && (typeof o[k] !== "string" || !DATE.test(o[k] as string))) return { ok: false, erreur: "Date illisible." };
    r[k] = o[k];
  }
  if (typeof r.debut === "string" && typeof r.fin === "string" && r.debut > r.fin) return { ok: false, erreur: "La fin précède le début." };
  if (o.plafond_utilisations !== undefined) {
    if (o.plafond_utilisations !== null && !entier(o.plafond_utilisations, 1)) return { ok: false, erreur: "Plafond illisible." };
    r.plafond_utilisations = o.plafond_utilisations;
  }
  for (const k of ["premiere_commande", "une_fois_par_client", "actif"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "boolean") return { ok: false, erreur: "Case illisible." };
    if (k === "actif" && neuf) continue; // un code naît inactif
    r[k] = o[k];
  }
  return { ok: true, valeur: r };
}
