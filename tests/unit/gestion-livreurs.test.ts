import { describe, expect, it } from "vitest";
import { ouvertureDe } from "@/lib/ouverture-service";

// Le restaurant sert-il ce service ce jour-là (écran Livreurs) : horaires du mardi au samedi, midi et soir.
const H = {
  horaires: [2, 3, 4, 5, 6].flatMap((jour) => [
    { jour, service: "midi" as const },
    { jour, service: "soir" as const },
  ]),
  fermetures: [
    { debut: "2026-12-22", fin: "2027-01-11", motif: "Fermeture annuelle", service: null },
    { debut: "2026-11-20", fin: "2026-11-20", motif: "Mariage", service: "soir" as const },
  ],
  ouvertures: [{ jour: "2026-11-15", service: "soir" as const }],
};

describe("ouvertureDe", () => {
  it("horaires de la semaine", () => {
    expect(ouvertureDe(H, "2026-11-17", "midi")).toEqual({ ouvert: true });
    expect(ouvertureDe(H, "2026-11-16", "soir")).toEqual({ ouvert: false, motif: null });
  });
  it("fermeture du jour ou d'un service, avec son motif", () => {
    expect(ouvertureDe(H, "2026-12-24", "midi")).toEqual({ ouvert: false, motif: "Fermeture annuelle" });
    expect(ouvertureDe(H, "2026-11-20", "soir")).toEqual({ ouvert: false, motif: "Mariage" });
    expect(ouvertureDe(H, "2026-11-20", "midi")).toEqual({ ouvert: true });
  });
  it("ouverture exceptionnelle un dimanche ; horaires pas lus : on ne sait pas", () => {
    expect(ouvertureDe(H, "2026-11-15", "soir")).toEqual({ ouvert: true });
    expect(ouvertureDe(null, "2026-11-15", "soir")).toBeNull();
  });
});
