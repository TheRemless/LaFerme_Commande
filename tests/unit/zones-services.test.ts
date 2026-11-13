import { beforeAll, describe, expect, it } from "vitest";
import { chargerConfigService } from "@/lib/config-service";
import { creneaux, etatService, quandPossible, zoneFermeeJusqua, zonePour, type ConfigService, type Zone } from "@/lib/service";

// Zones par service et zone fermée jusqu'à une heure (vague 3, bo-operations) : logique pure, sur la config
// lue dans la base embarquée (migration 20261130110000 comprise).

let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});

// Novembre : Genève est à UTC+1. Mardi 10 novembre 2026.
const geneve = (iso: string) => new Date(`${iso}+01:00`);
const avecZone1 = (z: Partial<Zone>): ConfigService => ({ ...config, zones: config.zones.map((x) => (x.numero === 1 ? { ...x, ...z } : x)) });
const zone1 = (c: ConfigService) => c.zones.find((z) => z.numero === 1)!;

describe("config lue en base", () => {
  it("chaque zone est livrée aux deux services, sans fermeture", () => {
    for (const z of config.zones) {
      expect(z.services).toEqual(["midi", "soir"]);
      expect(z.fermee_jusqu_a).toBeNull();
    }
  });
});

describe("zone livrée le soir seulement", () => {
  const soir = () => avecZone1({ services: ["soir"] });

  it("à midi : pas de « dès que possible », le prochain moment est le soir", () => {
    const e = etatService(soir(), geneve("2026-11-10T12:00:00"), "livraison", zone1(soir()));
    expect(e).toMatchObject({ etat: "ferme", prochain: { date: "2026-11-10", service: "soir" } });
    // Au retrait, midi reste ouvert.
    expect(etatService(soir(), geneve("2026-11-10T12:00:00"), "retrait").etat).toBe("ouvert");
  });

  it("les créneaux du midi ne sont pas proposés, ni refusés au paiement par erreur", () => {
    const c = soir();
    const liste = creneaux(c, geneve("2026-11-10T10:00:00"), "livraison", zone1(c));
    expect(liste.length).toBeGreaterThan(0);
    expect(liste.every((x) => x.service === "soir")).toBe(true);
    const midi = { type: "creneau" as const, date: "2026-11-11", minutes: 12 * 60 + 30 };
    const soir20h = { type: "creneau" as const, date: "2026-11-11", minutes: 20 * 60 };
    expect(quandPossible(c, geneve("2026-11-10T10:00:00"), "livraison", zone1(c), false, midi)).toBe(false);
    expect(quandPossible(c, geneve("2026-11-10T10:00:00"), "livraison", zone1(c), false, soir20h)).toBe(true);
  });

  it("le soir : « dès que possible » comme avant", () => {
    expect(etatService(soir(), geneve("2026-11-10T19:05:00"), "livraison", zone1(soir())).etat).toBe("ouvert");
  });
});

describe("zone fermée jusqu'à une heure", () => {
  const reel = geneve("2026-11-10T19:00:00").getTime();
  let fermee: ConfigService;
  beforeAll(() => {
    fermee = avecZone1({ fermee_jusqu_a: geneve("2026-11-10T21:00:00").toISOString(), fermee_motif: "Neige" });
  });

  it("fermée jusqu'à l'heure dite, avec son motif, puis rouvre seule", () => {
    expect(zonePour(fermee, "1213", "Onex", reel)).toEqual({
      statut: "zone-fermee",
      zone: zone1(fermee),
      jusqua: geneve("2026-11-10T21:00:00").toISOString(),
      motif: "Neige",
    });
    expect(zonePour(fermee, "1213", "Onex", geneve("2026-11-10T21:00:00").getTime())).toMatchObject({ statut: "livrable" });
    expect(zoneFermeeJusqua(zone1(fermee), reel)).toBe(geneve("2026-11-10T21:00:00").toISOString());
  });

  it("les autres zones restent livrables", () => {
    expect(zonePour(fermee, "1227", "Carouge", reel)).toMatchObject({ statut: "livrable", zone: { numero: 2 } });
  });

  it("une zone décochée reste fermée sans date", () => {
    const c = avecZone1({ active: false, fermee_jusqu_a: null });
    expect(zonePour(c, "1213", "Onex", reel)).toEqual({ statut: "zone-fermee", zone: zone1(c) });
  });
});
