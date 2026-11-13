import "server-only";
import { fonctionSql } from "@/lib/db/serveur";

// Plats les plus commandés sur 28 jours (décision C7) et suggestion au panier, éteints par défaut
// (réglages plats_populaires_actifs et suggestion_panier_active). Base muette ou fonction absente avant la
// migration : rien n'est montré.
import type { DonneesPopulaires } from "@/lib/suggestion";

export type Populaires = DonneesPopulaires;

export const SANS_POPULAIRES: Populaires = { populaires_actifs: false, suggestion_active: false, tous: [], par_categorie: {} };

export async function chargerPopulaires(): Promise<Populaires> {
  try {
    return (await fonctionSql<Populaires | null>("plats_populaires", {})) ?? SANS_POPULAIRES;
  } catch {
    return SANS_POPULAIRES;
  }
}
