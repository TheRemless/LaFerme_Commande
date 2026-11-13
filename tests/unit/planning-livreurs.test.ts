import { describe, expect, it } from "vitest";
import { periode } from "@/lib/planning-livreurs";

// Vendredi 20 novembre 2026, 23h30 à Genève (22h30 UTC).
const maintenant = new Date("2026-11-20T22:30:00Z");

describe("periode", () => {
  it("sans date : aujourd'hui à Genève et les six jours suivants", () => {
    expect(periode(undefined, undefined, 31, maintenant)).toEqual({ debut: "2026-11-20", fin: "2026-11-26" });
    // 0h30 à Genève le samedi : c'est déjà samedi.
    expect(periode(undefined, undefined, 31, new Date("2026-11-20T23:30:00Z"))).toEqual({ debut: "2026-11-21", fin: "2026-11-27" });
  });
  it("refuse une date illisible, une fin avant le début, une période trop longue", () => {
    expect(periode("2026-02-30", "2026-03-01", 31, maintenant)).toBeNull();
    expect(periode("20-11-2026", undefined, 31, maintenant)).toBeNull();
    expect(periode("2026-11-20", "2026-11-19", 31, maintenant)).toBeNull();
    // 31 jours au plus, bornes comprises.
    expect(periode("2026-11-01", "2026-12-02", 31, maintenant)).toBeNull();
    expect(periode("2026-11-01", "2026-12-01", 31, maintenant)).toEqual({ debut: "2026-11-01", fin: "2026-12-01" });
  });
});
