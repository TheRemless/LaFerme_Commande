import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chargerConfigService } from "@/lib/config-service";
import { zonePour, type ConfigService } from "@/lib/service";
import { zoneServeur } from "@/lib/zone-serveur";

// Décision de Jérémy du 12.11.2026 (CM-12) : tout le NPA 1219 (Le Lignon, Châtelaine, Aïre) en zone 2.
let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});
afterEach(() => vi.unstubAllGlobals());

describe("NPA 1219 en zone 2", () => {
  it("liste Le Lignon, Châtelaine et Aïre dans la zone 2", () => {
    const lignes = config.npa.filter((l) => l.npa === "1219");
    expect(lignes.map((l) => l.localite).sort()).toEqual(["Aïre", "Châtelaine", "Le Lignon"]);
    expect(new Set(lignes.map((l) => l.zone_numero))).toEqual(new Set([2]));
    for (const localite of ["Le Lignon", "Châtelaine", "Aïre"]) {
      expect(zonePour(config, "1219", localite)).toMatchObject({ statut: "livrable", zone: { numero: 2 } });
    }
  });

  it("au paiement, une adresse de 1219 tapée à la main sans adresse retrouvée n'a pas de zone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }))));
    const r = await zoneServeur(config, { rue: "Rue Inventée", numero: "1", npa: "1219", localite: "Châtelaine" }, true);
    expect(r).toMatchObject({ code: 422 });
  });
});
