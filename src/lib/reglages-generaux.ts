import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

// Réglages généraux du back-office (vague 3, bo-operations). Base : migration 20261130130000_reglages_generaux.sql.
// Doc : docs/reglages-generaux.md.

export type ReglagesGeneraux = {
  plafond_codes_clients_jour: number | null;
  creneau_minutes: number | null;
  avance_jours: number | null;
  alerte_email: string | null;
  annulation_client_active: boolean;
  // Interrupteurs de client-commande (décision C7), absents avant la migration 20261130170000.
  plats_populaires_actifs?: boolean;
  suggestion_panier_active?: boolean;
  // Rythme de la cuisine (heure promise réaliste), absent avant la migration 20261130180000.
  rythme?: Partial<Record<CleRythme, number>>;
};
export type CleRythme = "debit_pizza_quart_heure" | "debit_cuisine_quart_heure" | "allongement_max_minutes" | "fourchette_livraison_minutes" | "fourchette_retrait_minutes";
export const BORNES_RYTHME: Record<CleRythme, { min: number; max: number }> = {
  debit_pizza_quart_heure: { min: 0, max: 100 },
  debit_cuisine_quart_heure: { min: 0, max: 100 },
  allongement_max_minutes: { min: 0, max: 90 },
  fourchette_livraison_minutes: { min: 0, max: 60 },
  fourchette_retrait_minutes: { min: 0, max: 60 },
};
export type CleGenerale = Exclude<keyof ReglagesGeneraux, "rythme"> | CleRythme;

export const BORNES = {
  plafond_codes_clients_jour: { min: 20, max: 450 },
  avance_jours: { min: 0, max: 14 },
  creneau_minutes: { valeurs: [10, 15, 20, 30] },
} as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export const lireReglagesGeneraux = () => fonctionSql<ReglagesGeneraux>("reglages_generaux", {});

// Destinataire des alertes : l'adresse saisie au back-office, sinon la variable ALERTE_EMAIL. Base absente
// (pas encore migrée, panne) : la variable, comme avant.
export async function destinataireAlertes(): Promise<string | undefined> {
  const saisie = await lireReglagesGeneraux()
    .then((r) => r.alerte_email)
    .catch(() => null);
  return saisie || process.env.ALERTE_EMAIL || undefined;
}

export function validerReglage(cle: unknown, valeur: unknown): { ok: true; cle: CleGenerale; valeur: number | string | boolean | null } | { ok: false; erreur: string } {
  if (cle === "annulation_client_active" || cle === "plats_populaires_actifs" || cle === "suggestion_panier_active") {
    return typeof valeur === "boolean" ? { ok: true, cle, valeur } : { ok: false, erreur: "Oui ou non." };
  }
  if (cle === "alerte_email") {
    if (valeur === null || valeur === "") return { ok: true, cle, valeur: null };
    const v = typeof valeur === "string" ? valeur.trim().toLowerCase() : "";
    if (v.length > 120 || !EMAIL.test(v)) return { ok: false, erreur: "Adresse e-mail illisible." };
    return { ok: true, cle, valeur: v };
  }
  if (cle === "creneau_minutes") {
    return BORNES.creneau_minutes.valeurs.includes(valeur as 10) ? { ok: true, cle, valeur: valeur as number } : { ok: false, erreur: "Créneau : 10, 15, 20 ou 30 minutes." };
  }
  if (cle === "plafond_codes_clients_jour" || cle === "avance_jours") {
    const b = BORNES[cle];
    if (!Number.isInteger(valeur) || (valeur as number) < b.min || (valeur as number) > b.max) {
      return { ok: false, erreur: cle === "avance_jours" ? "Commande à l'avance : de 0 à 14 jours." : "Codes par jour : de 20 à 450." };
    }
    return { ok: true, cle, valeur: valeur as number };
  }
  if (typeof cle === "string" && cle in BORNES_RYTHME) {
    const b = BORNES_RYTHME[cle as CleRythme];
    if (!Number.isInteger(valeur) || (valeur as number) < b.min || (valeur as number) > b.max) return { ok: false, erreur: `Un nombre de ${b.min} à ${b.max}.` };
    return { ok: true, cle: cle as CleRythme, valeur: valeur as number };
  }
  return { ok: false, erreur: "Réglage inconnu." };
}

export async function reglerReglageGeneral(p: Personnel, cle: unknown, valeur: unknown): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const v = validerReglage(cle, valeur);
  if (!v.ok) return v;
  await fonctionSql("regler_reglage_general", { p_cle: v.cle, p_valeur: v.valeur === null ? null : String(v.valeur), p_personnel: p.id });
  // Créneau, jours à l'avance, annulation par le client : lus dans la config du service (en cache).
  if (v.cle === "plats_populaires_actifs" || v.cle === "suggestion_panier_active") rafraichirCaches("catalogue");
  // Créneau, jours à l'avance, annulation, rythme de la cuisine : lus dans la config du service (en cache).
  else if (v.cle !== "plafond_codes_clients_jour" && v.cle !== "alerte_email") rafraichirCaches("config-service");
  return { ok: true };
}
