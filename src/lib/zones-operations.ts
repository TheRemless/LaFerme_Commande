import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Zones par service et zone fermée jusqu'à une heure (vague 3, bo-operations). Doc : docs/zones-services.md.
// Base : supabase/migrations/20261130110000_zones_services.sql (revérifie le gérant ou l'équipe).

export type Resultat = { ok: true } | { ok: false; erreur: string; code?: number };

const numeroZone = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 100 ? (v as number) : null);
const SEPT_JOURS_MS = 7 * 24 * 3600_000;

async function apres(): Promise<void> {
  // Zones, créneaux et heures de l'accueil : la config est en cache, comme pour un horaire changé.
  rafraichirCaches("config-service");
  await signalerTablette();
}

// Gérant : services où la zone est livrée.
export async function reglerServicesZone(p: Personnel, numero: unknown, services: unknown): Promise<Resultat> {
  const n = numeroZone(numero);
  if (!n) return { ok: false, erreur: "Zone inconnue.", code: 404 };
  if (!Array.isArray(services) || services.length === 0 || services.some((s) => s !== "midi" && s !== "soir")) {
    return { ok: false, erreur: "Services : midi, soir ou les deux." };
  }
  const ok = await fonctionSql<boolean>("regler_zone_services", { p_numero: n, p_services: [...new Set(services)], p_personnel: p.id });
  if (!ok) return { ok: false, erreur: "Zone inconnue.", code: 404 };
  await apres();
  return { ok: true };
}

// Équipe (tablette ou back-office) : zone fermée jusqu'à une heure (ISO), avec un motif lu par le client.
export async function fermerZone(p: Personnel, numero: unknown, jusqua: unknown, motif: unknown, maintenant = Date.now()): Promise<Resultat> {
  const n = numeroZone(numero);
  if (!n) return { ok: false, erreur: "Zone inconnue.", code: 404 };
  const fin = typeof jusqua === "string" && jusqua.length <= 40 ? new Date(jusqua) : null;
  if (!fin || Number.isNaN(fin.getTime()) || fin.getTime() <= maintenant || fin.getTime() > maintenant + SEPT_JOURS_MS) {
    return { ok: false, erreur: "Fin de fermeture : une heure dans les sept jours qui viennent." };
  }
  const m = typeof motif === "string" ? motif.trim() : "";
  if (m.length < 2 || m.length > 120) return { ok: false, erreur: "Indiquez un motif (120 caractères au plus). Le client le lit." };
  const ok = await fonctionSql<boolean>("fermer_zone", { p_numero: n, p_jusqua: fin.toISOString(), p_motif: m, p_personnel: p.id });
  if (!ok) return { ok: false, erreur: "Zone inconnue.", code: 404 };
  await apres();
  return { ok: true };
}

// Équipe : rouvrir avant l'heure. Déjà rouverte : pas une erreur.
export async function rouvrirZone(p: Personnel, numero: unknown): Promise<Resultat & { deja?: boolean }> {
  const n = numeroZone(numero);
  if (!n) return { ok: false, erreur: "Zone inconnue.", code: 404 };
  const ok = await fonctionSql<boolean>("rouvrir_zone", { p_numero: n, p_personnel: p.id });
  if (ok) await apres();
  return { ok: true, deja: !ok };
}
