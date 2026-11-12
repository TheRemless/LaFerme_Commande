import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { creneaux, depuisHeureGeneve, etatService, instantGeneve, quandPossible, type ConfigService } from "@/lib/service";
import { ticketsDeCommande } from "@/lib/impression/ticket";

// Audit « samedi soir » : passages à l'heure d'été (29.3.2026, 27.3.2027) et d'hiver (25.10.2026),
// changement de jour, avec la configuration proposée en base (mardi au samedi, fermé dimanche et lundi).
let config: ConfigService;
beforeAll(async () => {
  const db = await creerBaseLocale();
  const q = async <T,>(sql: string) => (await db.query<T>(sql)).rows;
  const reglages = await q<{ cle: string; valeur: unknown }>("select cle, valeur from reglages");
  const v = (c: string) => Number(reglages.find((r) => r.cle === c)?.valeur);
  config = {
    zones: await q("select * from zones_livraison"),
    npa: await q("select * from zone_npa"),
    horaires: (await q<Record<string, string | number>>("select jour, service, premiere_heure::text, derniere_heure::text, derniere_commande::text, derniere_commande_pizzas::text from horaires")) as never,
    fermetures: (await q("select debut::text, fin::text, motif from fermetures")) as never,
    reglages: { preparation_minutes: v("preparation_minutes"), creneau_minutes: v("creneau_minutes"), avance_jours: v("avance_jours") },
    pause: { active: false, jusqua: null, livraisonFermee: false },
  };
});

describe("heure d'été et d'hiver", () => {
  it("l'heure qui n'existe pas (29.3, 2h30) est refusée, celle qui existe deux fois (25.10, 2h30) prend la première", () => {
    expect(depuisHeureGeneve("2026-03-29T02:30")).toBeNull();
    expect(depuisHeureGeneve("2026-10-25T02:30")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("mardi après le passage à l'heure d'été : 19h00 de Genève = 17h00 UTC, et les créneaux commandés le samedi d'avant tombent juste", () => {
    expect(depuisHeureGeneve("2026-03-31T19:00")?.toISOString()).toBe("2026-03-31T17:00:00.000Z");
    // Samedi 28.3.2026 à 22h50 (heure d'hiver) : créneaux du mardi 31.3 (heure d'été).
    const samedi = new Date("2026-03-28T21:50:00Z");
    const liste = creneaux(config, samedi, "retrait", undefined, true).filter((c) => c.date === "2026-03-31");
    expect(liste.length).toBeGreaterThan(0);
    expect(quandPossible(config, samedi, "retrait", undefined, true, { type: "creneau", date: "2026-03-31", minutes: 19 * 60 })).toBe(true);
  });

  it("mardi après le passage à l'heure d'hiver : 19h00 de Genève = 18h00 UTC, état ouvert à 19h", () => {
    expect(depuisHeureGeneve("2026-10-27T19:00")?.toISOString()).toBe("2026-10-27T18:00:00.000Z");
    expect(etatService(config, new Date("2026-10-27T18:00:00Z"), "retrait").etat).toBe("ouvert");
    expect(instantGeneve(new Date("2026-10-27T18:00:00Z"))).toEqual({ date: "2026-10-27", jour: 2, minutes: 19 * 60 });
  });

  it("le dimanche du changement d'heure, le restaurant est fermé : aucun créneau ce jour-là", () => {
    const liste = creneaux(config, new Date("2026-10-24T20:00:00Z"), "retrait", undefined, true);
    expect(liste.some((c) => c.date === "2026-10-25" || c.date === "2026-10-26")).toBe(false);
  });

  it("le ticket d'une commande à l'avance porte le jour de la commande, pas celui de l'acceptation", () => {
    const t = ticketsDeCommande(
      { numero: 1, mode: "retrait", client_prenom: "A", client_nom: "B", client_telephone: "0", adresse: null, details_livraison: null, heure_confirmee: "2026-11-14T18:30:00Z", statut_paiement: "paye", moyen_paiement: "en_ligne", lignes: [{ nom: "Lasagne de bœuf", qte: 1, station: "cuisine", details: ["SANS œufs"] }] },
      { accepteLe: "2026-11-11T09:00:00Z" },
    )[0].contenu;
    expect(JSON.stringify(t)).toContain("Samedi, 14.11.2026");
    expect(JSON.stringify(t)).toContain("acceptée 10:00");
    expect(JSON.stringify(t)).toContain("N° 001");
  });
});
