import { describe, expect, it } from "vitest";
import { evaluerSante } from "@/lib/sante";
import { lireEtatSurveillance } from "@/lib/db/serveur";

const maintenant = new Date("2026-11-14T19:30:00Z");
const ilYa = (s: number) => new Date(maintenant.getTime() - s * 1000).toISOString();
const base = { ok: true as const, ms: 12 };

describe("route de santé", () => {
  it("tout va bien : 200, aucune donnée personnelle, seulement des heures et des états", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: "abc1234", base, etat: { surveillance_le: ilYa(30), tablette_vue_le: ilYa(20) }, enService: true });
    expect(r.http).toBe(200);
    expect(r.corps).toEqual({
      etat: "ok",
      heure: maintenant.toISOString(),
      version: "abc1234",
      contexte: "production",
      base: { ok: true, ms: 12 },
      surveillance: { dernier_passage: ilYa(30), il_y_a_s: 30, en_retard: false },
      service: { en_cours: true },
      tablette: { dernier_signe: ilYa(20), il_y_a_s: 20, muette: false },
    });
  });

  it("base injoignable : 503 et « panne »", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: null, base: { ok: false, ms: 5000 }, etat: null, enService: false });
    expect(r.http).toBe(503);
    expect(r.corps.etat).toBe("panne");
    expect(r.corps.surveillance.dernier_passage).toBeNull();
  });

  it("surveillance arrêtée depuis plus de 5 minutes en production : 503 et « dégradé »", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: null, base, etat: { surveillance_le: ilYa(301), tablette_vue_le: null }, enService: false });
    expect(r.http).toBe(503);
    expect(r.corps.etat).toBe("degrade");
    expect(r.corps.surveillance.en_retard).toBe(true);
  });

  it("surveillance jamais passée en production : en retard", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: null, base, etat: { surveillance_le: null, tablette_vue_le: null }, enService: false });
    expect(r.corps.surveillance.en_retard).toBe(true);
    expect(r.http).toBe(503);
  });

  it("préversion : la fonction planifiée n'y tourne pas, une surveillance ancienne ne déclenche rien", () => {
    const r = evaluerSante({ maintenant, contexte: "deploy-preview", version: null, base, etat: { surveillance_le: ilYa(9000), tablette_vue_le: null }, enService: false });
    expect(r.http).toBe(200);
    expect(r.corps.etat).toBe("ok");
    expect(r.corps.surveillance.en_retard).toBe(false);
  });

  it("tablette muette depuis plus de 3 minutes pendant le service : signalée, sans faire tomber le site", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: null, base, etat: { surveillance_le: ilYa(10), tablette_vue_le: ilYa(181) }, enService: true });
    expect(r.corps.tablette.muette).toBe(true);
    expect(r.corps.etat).toBe("ok");
    expect(r.http).toBe(200);
  });

  it("tablette éteinte hors service : normal", () => {
    const r = evaluerSante({ maintenant, contexte: "production", version: null, base, etat: { surveillance_le: ilYa(10), tablette_vue_le: ilYa(36000) }, enService: false });
    expect(r.corps.tablette.muette).toBe(false);
  });

  it("lit l'état de la surveillance dans la base embarquée", async () => {
    const etat = await lireEtatSurveillance();
    expect(Object.keys(etat).sort()).toEqual(["surveillance_le", "tablette_vue_le"]);
  });
});
