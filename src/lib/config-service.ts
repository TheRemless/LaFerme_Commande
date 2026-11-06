import "server-only";
import { lirePublic } from "@/lib/db/lecture";
import type { ConfigService, Fermeture, Horaire, Zone, ZoneNpa } from "@/lib/service";

type LigneReglage = { cle: string; valeur: unknown };

function nombre(reglages: LigneReglage[], cle: string): number {
  const v = Number(reglages.find((r) => r.cle === cle)?.valeur);
  if (!Number.isFinite(v)) throw new Error(`Réglage manquant ou invalide : ${cle}`);
  return v;
}

// Tout ce qu'il faut pour décider zone, créneaux et état du restaurant, lu en base.
export async function chargerConfigService(): Promise<ConfigService> {
  const [zones, npa, horaires, fermetures, reglages] = await Promise.all([
    lirePublic<Zone>("zones_livraison"),
    lirePublic<ZoneNpa>("zone_npa"),
    lirePublic<Horaire>("horaires"),
    lirePublic<Fermeture & { debut: string | Date; fin: string | Date }>("fermetures"),
    lirePublic<LigneReglage>("reglages"),
  ]);
  // PGlite rend les dates en objets Date, Supabase en texte : on ramène tout au format AAAA-MM-JJ.
  const jour = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
  return {
    zones,
    npa,
    horaires,
    fermetures: fermetures.map((f) => ({ ...f, debut: jour(f.debut), fin: jour(f.fin) })),
    reglages: {
      preparation_minutes: nombre(reglages, "preparation_minutes"),
      creneau_minutes: nombre(reglages, "creneau_minutes"),
      avance_jours: nombre(reglages, "avance_jours"),
    },
  };
}
