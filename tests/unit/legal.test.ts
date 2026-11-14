import { afterEach, describe, expect, it } from "vitest";
import { pageLegalePubliable, pagesLegalesValidees } from "@/lib/legal/acces";
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
    const complete = { titre: "T", misAJour: "", sections: [{ titre: "S", contenu: ["Tout est rempli."] }] };
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pageLegalePubliable(complete)).toBe(false);
    process.env.PAGES_LEGALES_VALIDEES = "1";
    expect(pagesLegalesValidees()).toBe(true);
    expect(pageLegalePubliable(complete)).toBe(true);
    // Validée mais encore trouée : toujours fermée.
    expect(pageLegalePubliable(MENTIONS)).toBe(false);
    process.env.CONTEXTE_DEPLOIEMENT = "deploy-preview";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pageLegalePubliable(MENTIONS)).toBe(true);
  });

  it("signalent ce qui reste à fournir et n'inventent pas de faits interdits", () => {
    for (const p of [MENTIONS, CGV, CONFIDENTIALITE]) {
      expect(aCompleter(p)).toBeGreaterThan(0);
      const texte = JSON.stringify(p).toLowerCase();
      for (const interdit of ["fait maison", "napolitain", "450", "chêne", "banquet", "tram", "apple pay", "google pay"]) {
        expect(texte).not.toContain(interdit);
      }
    }
    // Identité du vendeur (LCD art. 3 al. 1 let. s) : fournie par Jérémy le 13.11.2026 (extrait du registre du
    // commerce, registre IDE fédéral pour la TVA). La même raison sociale dans les trois pages.
    for (const p of [MENTIONS, CGV, CONFIDENTIALITE]) {
      expect(JSON.stringify(p)).toContain("Restaurant La Ferme Sàrl");
      expect(JSON.stringify(p).toLowerCase()).not.toContain("[raison sociale");
    }
    expect(JSON.stringify(MENTIONS)).toContain("société à responsabilité limitée");
    expect(JSON.stringify(MENTIONS)).toContain("Numéro IDE CHE-103.250.692. Numéro TVA CHE-103.250.692 TVA.");
    // L'e-mail reste demandé, pas deviné.
    expect(JSON.stringify(MENTIONS)).toContain("[adresse e-mail du restaurant]");
  });

  it("CGV, paiement : au comptoir pour l'emporter, à la livraison ou au retrait pour une commande par téléphone", () => {
    // Commande prise au téléphone (#248), payée à la livraison ou au retrait ; les livreurs auront un terminal de
    // carte (Jérémy, 14.11.2026). L'ancienne phrase « pas de paiement à la livraison » ne doit pas revenir.
    const paiement = CGV.sections.find((s) => s.titre === "Paiement");
    const texte = JSON.stringify(paiement?.contenu);
    expect(texte).toContain("Au comptoir, pour une commande à emporter.");
    expect(texte).toContain("Pour une commande passée par téléphone, à la livraison ou au retrait, en espèces ou par carte.");
    expect(JSON.stringify(CGV).toLowerCase()).not.toContain("paiement à la livraison n'est pas proposé");
  });
});
