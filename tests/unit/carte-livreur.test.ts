import { describe, expect, it } from "vitest";
import { rayonPrecision, tuilesAutour } from "@/lib/carte-livreur";

describe("carte du livreur au suivi", () => {
  it("9 tuiles swisstopo autour de la position, le livreur dans la tuile du centre", () => {
    // Onex (Route de Chancy) : tuile 33876 / 23266 au zoom 16, vérifiée sur wmts.geo.admin.ch le 13.11.2026.
    const { tuiles, x, y } = tuilesAutour(46.1867, 6.0896);
    expect(tuiles).toHaveLength(9);
    expect(tuiles[4].url).toBe("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/16/33876/23266.jpeg");
    expect(tuiles[0].url).toContain("/16/33875/23265.jpeg");
    expect(tuiles[8]).toMatchObject({ gauche: 512, haut: 512 });
    expect(x).toBeGreaterThanOrEqual(256);
    expect(x).toBeLessThan(512);
    expect(y).toBeGreaterThanOrEqual(256);
    expect(y).toBeLessThan(512);
  });

  it("précision en pixels, bornée", () => {
    expect(rayonPrecision(null, 46.2)).toBeNull();
    expect(rayonPrecision(0, 46.2)).toBeNull();
    // Environ 1,65 m par pixel à Genève au zoom 16 : 30 m ≈ 18 px.
    expect(rayonPrecision(30, 46.2)).toBeCloseTo(18.2, 0);
    expect(rayonPrecision(1, 46.2)).toBe(10);
    expect(rayonPrecision(5000, 46.2)).toBe(120);
  });
});
