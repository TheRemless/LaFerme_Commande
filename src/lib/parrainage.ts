import "server-only";
import { fonctionSql } from "@/lib/db/serveur";

// Parrainage (validé par Jérémy le 15.11.2026). Les règles sont en base (20261216100000_parrainage.sql). Le lien
// /parrain/<code> pose un cookie avec le code seul ; un compte créé ensuite est rattaché à la connexion.

export const COOKIE_PARRAIN = "laferme-parrain";
export const DUREE_PARRAIN_S = 30 * 24 * 3600;

export type ParrainageCompte = {
  actif: boolean;
  code: string | null;
  // Parrain qualifié : une commande remise, payée et au minimum (20261216190000). Absents avant cette migration.
  qualifie?: boolean;
  minimum_centimes?: number;
  montant_centimes: number;
  credites: number;
  en_attente: number;
  parraine: "en_attente" | "credite" | "refuse" | null;
};

// Code du lien : 8 caractères, sans 0, O, 1 ni I. Sinon rien.
export function codeParrainValide(v: unknown): string | null {
  const c = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? c : null;
}

export const lierParrainage = (email: string, code: string) => fonctionSql<string>("lier_parrainage", { p_email: email, p_code: code });

export const parrainageCompte = (compte: string) => fonctionSql<ParrainageCompte>("parrainage_compte", { p_compte: compte });
