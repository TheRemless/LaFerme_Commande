import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";

// Position du livreur en direct (vague 3, décision de Jérémy du 13.11.2026). Toutes les règles sont en base
// (migration 20261213210000_position_livreur.sql) : position gardée pour l'arrêt en cours seulement, lue au suivi de
// cette commande seulement, effacée à la livraison. Ici, de simples appels.

export type StatutPosition = "ok" | "pas_en_route" | "ignoree" | "desactive";
export type PositionSuivi = { lat: number; lon: number; precision: number; le: string };

export const noterPosition = (p: Personnel, lat: number, lon: number, precision: number) =>
  fonctionSql<{ statut: StatutPosition; numero?: number }>("noter_position_livreur", {
    p_livreur: p.id,
    p_lat: lat,
    p_lon: lon,
    p_precision: Math.round(precision),
  });

export const effacerPosition = (p: Personnel) => fonctionSql<null>("effacer_position_livreur", { p_livreur: p.id });

// Au suivi : null tant que la commande n'est pas l'arrêt en cours de son livreur (ou sans position récente).
export async function positionPourSuivi(commandeId: string): Promise<PositionSuivi | null> {
  const r = await fonctionSql<{ lat: number | string; lon: number | string; precision: number; le: string } | null>("position_pour_suivi", {
    p_commande: commandeId,
  });
  return r ? { lat: Number(r.lat), lon: Number(r.lon), precision: r.precision, le: r.le } : null;
}
