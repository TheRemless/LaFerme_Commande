import "server-only";
import { unstable_cache } from "next/cache";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { lireCharge, lireFourchette } from "@/lib/heure-reelle";
import { IMPRESSION_AVANCE_DEFAUT, type DelaisImpression } from "@/lib/impression/avance";
import { lirePlafondComptoir } from "@/lib/plafond-comptoir";
import type { ConfigService, Fermeture, Horaire, Ouverture, Zone, ZoneNpa } from "@/lib/service";

type LigneReglage = { cle: string; valeur: unknown };

function nombre(reglages: LigneReglage[], cle: string): number {
  const v = Number(reglages.find((r) => r.cle === cle)?.valeur);
  if (!Number.isFinite(v)) throw new Error(`Réglage manquant ou invalide : ${cle}`);
  return v;
}

// Tickets d'une commande acceptée : ce temps avant l'heure promise, par mode (audit « samedi soir », SS-11).
// Réglage absent (base pas encore migrée) ou hors bornes : la valeur validée par Jérémy.
function impressionAvance(reglages: LigneReglage[]): DelaisImpression {
  const lire = (mode: keyof DelaisImpression) => {
    const v = Number(reglages.find((r) => r.cle === `impression_avance_${mode}_minutes`)?.valeur);
    return Number.isInteger(v) && v >= 15 && v <= 240 ? v : IMPRESSION_AVANCE_DEFAUT[mode];
  };
  return { livraison: lire("livraison"), retrait: lire("retrait") };
}

// Tout ce qu'il faut pour décider zone, créneaux et état du restaurant, lu en base.
async function lireConfigService(): Promise<ConfigService & { plafondComptoirCentimes: number | null }> {
  const [zones, npa, horaires, fermetures, reglages, ouvertures, chargeBrute] = await Promise.all([
    lirePublic<Zone>("zones_livraison"),
    lirePublic<ZoneNpa>("zone_npa"),
    lirePublic<Horaire>("horaires"),
    lirePublic<Fermeture & { debut: string | Date; fin: string | Date }>("fermetures"),
    lirePublic<LigneReglage>("reglages"),
    // Ouvertures exceptionnelles (audit du gérant, vague 2). Table absente tant que la base n'est pas migrée.
    lirePublic<Ouverture & { jour: string | Date }>("ouvertures").catch(() => [] as (Ouverture & { jour: string | Date })[]),
    // File réelle de chaque poste (heure promise réaliste, vague 3). Absente (base pas encore migrée, build
    // sans clé du serveur) : pas d'allongement, les heures restent celles du délai fixe.
    fonctionSql<unknown>("charge_cuisine", {}).catch(() => null),
  ]);
  // PGlite rend les dates en objets Date, Supabase en texte : on ramène tout au format AAAA-MM-JJ.
  const jour = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
  // Retard du soir réglé sur la tablette (audit du gérant, G05) : ajouté au retrait et à chaque zone, pour
  // toutes les heures annoncées. Absent (base pas encore migrée) : zéro. Remis à zéro chaque nuit (G06).
  const brut = Number(reglages.find((r) => r.cle === "retard_minutes")?.valeur ?? 0);
  const retardManuel = Number.isInteger(brut) && brut > 0 && brut <= 90 ? brut : 0;
  // Allongement dû à la file réelle des postes (heure promise réaliste) : ajouté comme le retard du soir à
  // toutes les heures annoncées. retard_minutes reste le retard posé à la main (la tablette règle +5 et -5
  // à partir de lui) : l'allongement n'y entre jamais.
  const charge = lireCharge(chargeBrute);
  const allongement = charge?.allongement_minutes ?? 0;
  const retard = retardManuel + allongement;
  const preparation = nombre(reglages, "preparation_minutes");
  return {
    zones: retard ? zones.map((z) => ({ ...z, delai_min: z.delai_min + retard, delai_max: z.delai_max + retard })) : zones,
    npa,
    horaires,
    fermetures: fermetures.map((f) => ({ ...f, debut: jour(f.debut), fin: jour(f.fin), service: f.service ?? null })),
    ouvertures: ouvertures.map((o) => ({
      jour: jour(o.jour),
      service: o.service,
      premiere_heure: o.premiere_heure,
      derniere_heure: o.derniere_heure,
      derniere_commande: o.derniere_commande,
      derniere_commande_pizzas: o.derniere_commande_pizzas,
    })),
    reglages: {
      preparation_minutes: preparation + retard,
      preparation_base: preparation,
      retard_minutes: retardManuel,
      allongement_minutes: allongement,
      charge,
      fourchette: lireFourchette(reglages),
      creneau_minutes: nombre(reglages, "creneau_minutes"),
      avance_jours: nombre(reglages, "avance_jours"),
      impression_avance: impressionAvance(reglages),
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
    // Plafond des commandes à payer au comptoir ; null si le réglage manque (pas de comptoir).
    plafondComptoirCentimes: lirePlafondComptoir(reglages),
  };
}

// Une minute de cache : une pause ou un horaire changé dans le back-office s'applique en moins d'une minute.
export const chargerConfigService = process.env.VITEST
  ? lireConfigService
  : unstable_cache(lireConfigService, ["config-service"], { revalidate: 60, tags: ["config-service"] });
