import { afterEach, describe, expect, it } from "vitest";
import { pagesLegalesValidees, pagesLegalesVisibles } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";
import { CONFIDENTIALITE } from "@/lib/legal/confidentialite";
import { MENTIONS } from "@/lib/legal/mentions";
import { aCompleter } from "@/lib/legal/types";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("ébauches légales", () => {
  it("restent fermées en production tant qu'elles ne sont pas validées", () => {
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pagesLegalesVisibles()).toBe(false);
    process.env.PAGES_LEGALES_VALIDEES = "1";
    expect(pagesLegalesVisibles()).toBe(true);
    expect(pagesLegalesValidees()).toBe(true);
    process.env.CONTEXTE_DEPLOIEMENT = "deploy-preview";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pagesLegalesVisibles()).toBe(true);
  });

  it("signalent ce qui reste à fournir et n'inventent pas de faits interdits", () => {
    for (const p of [MENTIONS, CGV, CONFIDENTIALITE]) {
      expect(aCompleter(p)).toBeGreaterThan(0);
      const texte = JSON.stringify(p).toLowerCase();
      for (const interdit of ["fait maison", "napolitain", "450", "chêne", "banquet", "tram", "apple pay", "google pay"]) {
        expect(texte).not.toContain(interdit);
      }
    }
    // L'identité du vendeur et l'e-mail (LCD art. 3 al. 1 let. s) sont demandés, pas devinés.
    expect(JSON.stringify(MENTIONS)).toContain("[Raison sociale");
    expect(JSON.stringify(MENTIONS)).toContain("[adresse e-mail du restaurant]");
  });
});
