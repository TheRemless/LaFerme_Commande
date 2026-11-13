import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";

// Alertes réglables par type (vague 3, bo-operations). Base : 20261130260000_types_alertes.sql.
// Doc : docs/reglages-generaux.md, « Alertes par type ».

export type GenreAlerte =
  | "commande_en_attente"
  | "tablette_muette"
  | "ticket_non_imprime"
  | "remboursement"
  | "client_absent"
  | "reclamation"
  | "quota_courriels"
  | "plafond_codes"
  | "adresse_bloquee";

export type TypeAlerte = { cle: GenreAlerte; libelle: string; aide: string | null; actif: boolean };

export const lireTypesAlertes = () => fonctionSql<TypeAlerte[]>("types_alertes", {});

// Le type est-il envoyé ? Base absente (pas encore migrée) ou en panne : oui, comme avant. Une alerte ne se
// perd jamais par défaut.
export async function alerteActive(genre: GenreAlerte): Promise<boolean> {
  const types = await lireTypesAlertes().catch(() => null);
  return types?.find((t) => t.cle === genre)?.actif ?? true;
}

export async function reglerTypeAlerte(p: Personnel, cle: unknown, actif: unknown): Promise<{ ok: true } | { ok: false; erreur: string }> {
  if (typeof cle !== "string" || !/^[a-z_]{2,40}$/.test(cle)) return { ok: false, erreur: "Type d'alerte inconnu." };
  if (typeof actif !== "boolean") return { ok: false, erreur: "Oui ou non." };
  const ok = await fonctionSql<boolean>("regler_type_alerte", { p_cle: cle, p_actif: actif, p_personnel: p.id });
  return ok ? { ok: true } : { ok: false, erreur: "Type d'alerte inconnu." };
}
