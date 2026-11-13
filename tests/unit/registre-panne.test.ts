import { beforeAll, describe, expect, it, vi } from "vitest";
import { chargerConfigService } from "@/lib/config-service";
import { MESSAGE_REGISTRE_EN_PANNE, estPanneRegistre } from "@/lib/registre-panne";
import type { ConfigService } from "@/lib/service";

// Vague 3, client-commande (P1 de produit-client) : quand le service fédéral des adresses ne répond pas, le
// message laisse deux issues au client, commander à emporter ou appeler le restaurant.

vi.mock("@/lib/adresse-serveur", async (original) => ({
  ...(await original<typeof import("@/lib/adresse-serveur")>()),
  adresseOfficielle: async () => {
    throw new Error("Registre des bâtiments indisponible (503)");
  },
  retrouverAdresse: async () => {
    throw new Error("Registre des bâtiments indisponible (503)");
  },
}));

let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});

describe("service fédéral des adresses en panne", () => {
  it("le message donne les deux issues : à emporter et le téléphone du restaurant", () => {
    expect(MESSAGE_REGISTRE_EN_PANNE).toContain("Commandez à emporter");
    expect(MESSAGE_REGISTRE_EN_PANNE.replace(/\s/g, " ")).toContain("022 792 16 89");
    expect(MESSAGE_REGISTRE_EN_PANNE).not.toContain("Réessayez");
    expect(estPanneRegistre(MESSAGE_REGISTRE_EN_PANNE)).toBe(true);
    expect(estPanneRegistre("Cette adresse est hors de notre zone de livraison.")).toBe(false);
  });

  it("adresse choisie dans les suggestions : 503 et ce message", async () => {
    const { zoneServeur } = await import("@/lib/zone-serveur");
    expect(await zoneServeur(config, { featureId: "1234567_0", rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" })).toEqual({
      erreur: MESSAGE_REGISTRE_EN_PANNE,
      code: 503,
    });
  });

  it("adresse tapée à la main, au paiement : 503 et ce message", async () => {
    const { zoneServeur } = await import("@/lib/zone-serveur");
    expect(await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }, true)).toEqual({
      erreur: MESSAGE_REGISTRE_EN_PANNE,
      code: 503,
    });
  });
});
