import "server-only";
import { unstable_cache } from "next/cache";
import { lirePublic } from "@/lib/db/lecture";
import type { ConfigService, Fermeture, Horaire, Zone, ZoneNpa } from "@/lib/service";

type LigneReglage = { cle: string; valeur: unknown };

function nombre(reglages: LigneReglage[], cle: string): number {
  const v = Number(reglages.find((r) => r.cle === cle)?.valeur);
  if (!Number.isFinite(v)) throw new Error(`Réglage manquant ou invalide : ${cle}`);
  return v;
}

// Tout ce qu'il faut pour décider zone, créneaux et état du restaurant, lu en base.
async function lireConfigService(): Promise<ConfigService> {
  const [zones, npa, horaires, fermetures, reglages] = await Promise.all([
    lirePublic<Zone>("zones_livraison"),
    lirePublic<ZoneNpa>("zone_npa"),
    lirePublic<Horaire>("horaires"),
    lirePublic<Fermeture & { debut: string | Date; fin: string | Date }>("fermetures"),
    lirePublic<LigneReglage>("reglages"),
  ]);
  // PGlite rend les dates en objets Date, Supabase en texte : on ramène tout au format AAAA-MM-JJ.
  const jour = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
  // Retard du soir réglé sur la tablette (audit du gérant, G05) : ajouté au retrait et à chaque zone, pour
  // toutes les heures annoncées. Absent (base pas encore migrée) : zéro. Remis à zéro chaque nuit (G06).
  const brut = Number(reglages.find((r) => r.cle === "retard_minutes")?.valeur ?? 0);
  const retard = Number.isInteger(brut) && brut > 0 && brut <= 90 ? brut : 0;
  const preparation = nombre(reglages, "preparation_minutes");
  return {
    zones: retard ? zones.map((z) => ({ ...z, delai_min: z.delai_min + retard, delai_max: z.delai_max + retard })) : zones,
    npa,
    horaires,
    fermetures: fermetures.map((f) => ({ ...f, debut: jour(f.debut), fin: jour(f.fin) })),
    reglages: {
      preparation_minutes: preparation + retard,
      preparation_base: preparation,
      retard_minutes: retard,
      creneau_minutes: nombre(reglages, "creneau_minutes"),
      avance_jours: nombre(reglages, "avance_jours"),
    },
    pause: (() => {
      const jusqua = reglages.find((r) => r.cle === "pause_jusqu_a")?.valeur;
      // valeur : null (pas de pause), "sans-fin", ou une date ISO.
      return {
        active: typeof jusqua === "string",
        jusqua: typeof jusqua === "string" && jusqua !== "sans-fin" ? jusqua : null,
        livraisonFermee: reglages.find((r) => r.cle === "livraison_fermee")?.valeur === true,
        // Pause mise par la surveillance (tablette muette pendant le service).
        auto: reglages.find((r) => r.cle === "pause_auto")?.valeur === true,
      };
    })(),
  };
}

// Une minute de cache : une pause ou un horaire changé dans le back-office s'applique en moins d'une minute.
export const chargerConfigService = process.env.VITEST
  ? lireConfigService
  : unstable_cache(lireConfigService, ["config-service"], { revalidate: 60, tags: ["config-service"] });
