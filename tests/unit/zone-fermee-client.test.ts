import { beforeAll, describe, expect, it } from "vitest";
import { chargerConfigService } from "@/lib/config-service";
import type { ConfigService } from "@/lib/service";
import { zoneServeur } from "@/lib/zone-serveur";
import { messageZoneFermee } from "@/lib/zone-fermee";

// Vague 3, client-commande : une zone fermée jusqu'à une heure (neige, livreur malade, #79 de bo-operations)
// n'est pas « hors zone » pour le client : on lui dit quand la livraison reprend.

let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});

function fermee(jusqua: string | null): ConfigService {
  return { ...config, zones: config.zones.map((z) => (z.numero === 1 ? { ...z, fermee_jusqu_a: jusqua } : z)) };
}

describe("message de reprise", () => {
  it("le même jour : l'heure seule", () => {
    expect(messageZoneFermee("2026-11-10T20:00:00Z", new Date("2026-11-10T18:05:00Z"))).toBe("La livraison reprend à 21h00 dans votre quartier.");
  });
  it("un autre jour : le jour et l'heure", () => {
    expect(messageZoneFermee("2026-11-11T10:30:00Z", new Date("2026-11-10T18:05:00Z"))).toBe("La livraison reprend le mercredi 11 novembre à 11h30 dans votre quartier.");
  });
});

describe("zone de l'adresse côté serveur", () => {
  const onex = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" };
  it("zone fermée jusqu'à une heure à venir : zone-fermee avec l'heure de reprise", async () => {
    const jusqua = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const r = await zoneServeur(fermee(jusqua), onex);
    expect(r).toMatchObject({ statut: "zone-fermee", jusqua });
  });
  it("heure de reprise passée : livrable de nouveau", async () => {
    const r = await zoneServeur(fermee(new Date(Date.now() - 60_000).toISOString()), onex);
    expect(r).toMatchObject({ statut: "livrable" });
  });
});
