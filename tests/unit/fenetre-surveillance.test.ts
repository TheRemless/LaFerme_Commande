import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dansFenetreSurveillance, FENETRES_SURVEILLANCE, minutesGeneve, PLANIFICATION_SURVEILLANCE } from "@/lib/fenetre-surveillance";
import { evaluerSante } from "@/lib/sante";

// Netlify sobre (19.11.2026) : la fonction planifiée ne lance la surveillance qu'aux heures utiles, toutes les 2 minutes.

// Heures UTC où la planification se déclenche (forme « */2 h1-h2,h3-h4 * * * »).
function heuresPlanifiees(cron: string): Set<number> {
  const [minute, heures, ...reste] = cron.split(" ");
  expect(minute).toBe("*/2");
  expect(reste).toEqual(["*", "*", "*"]);
  const h = new Set<number>();
  for (const plage of heures.split(",")) {
    const [a, b] = plage.split("-").map(Number);
    for (let x = a; x <= (b ?? a); x++) h.add(x);
  }
  return h;
}

describe("fenêtres de la surveillance planifiée", () => {
  it("la planification de la fonction Netlify est celle du module", () => {
    const source = readFileSync(path.resolve(__dirname, "../../netlify/functions/surveillance.mts"), "utf8");
    expect(source).toContain(`schedule: "${PLANIFICATION_SURVEILLANCE}"`);
  });

  it("chaque minute des fenêtres, toute l'année (heure d'été et d'hiver), tombe dans une heure planifiée", () => {
    const heures = heuresPlanifiees(PLANIFICATION_SURVEILLANCE);
    const manquees: string[] = [];
    // Un an à la minute, à partir du 1.1.2027 (UTC) : passages à l'heure d'été et retour.
    const debut = Date.UTC(2027, 0, 1);
    for (let t = debut; t < debut + 365 * 24 * 3600_000; t += 60_000) {
      const d = new Date(t);
      if (dansFenetreSurveillance(d) && !heures.has(d.getUTCHours())) manquees.push(d.toISOString());
    }
    expect(manquees.slice(0, 5)).toEqual([]);
  });

  it("couvre les services (11h-14h, 18h30-23h) avec une marge, et rien la nuit", () => {
    // 19.11.2026 : heure d'hiver (UTC+1). 15.7.2027 : heure d'été (UTC+2).
    for (const [iso, attendu] of [
      ["2026-11-19T10:00:00Z", true], // 11h00
      ["2026-11-19T12:59:00Z", true], // 13h59
      ["2026-11-19T17:30:00Z", true], // 18h30
      ["2026-11-19T21:59:00Z", true], // 22h59
      ["2026-11-19T22:59:00Z", true], // 23h59
      ["2026-11-19T23:00:00Z", false], // minuit
      ["2026-11-19T03:00:00Z", false], // 4h
      ["2026-11-19T15:00:00Z", false], // 16h, entre les services
      ["2027-07-15T09:00:00Z", true], // 11h
      ["2027-07-15T16:30:00Z", true], // 18h30
      ["2027-07-15T21:30:00Z", true], // 23h30
      ["2027-07-15T22:00:00Z", false], // minuit
    ] as const) {
      expect([iso, dansFenetreSurveillance(new Date(iso))]).toEqual([iso, attendu]);
    }
    expect(minutesGeneve(new Date("2026-11-19T17:30:00Z"))).toBe(18 * 60 + 30);
    expect(FENETRES_SURVEILLANCE.every((f) => f.debut < f.fin)).toBe(true);
  });

  it("santé : la nuit, une surveillance silencieuse n'est pas en retard ; en fenêtre depuis plus de 5 minutes, si", () => {
    const base = { ok: true as const, ms: 10 };
    const nuit = new Date("2026-11-19T02:00:00Z");
    const soir = new Date("2026-11-19T19:30:00Z");
    const ouverture = new Date("2026-11-19T16:32:00Z"); // 17h32 : fenêtre ouverte depuis 2 minutes
    const vieux = (d: Date) => new Date(d.getTime() - 8 * 3600_000).toISOString();
    const sante = (maintenant: Date) =>
      evaluerSante({ maintenant, contexte: "production", version: null, base, etat: { surveillance_le: vieux(maintenant), tablette_vue_le: null }, enService: false });
    expect(sante(nuit).corps.surveillance.en_retard).toBe(false);
    expect(sante(nuit).http).toBe(200);
    expect(sante(ouverture).corps.surveillance.en_retard).toBe(false);
    expect(sante(soir).corps.surveillance.en_retard).toBe(true);
    expect(sante(soir).http).toBe(503);
  });
});
