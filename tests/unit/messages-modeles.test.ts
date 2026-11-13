import { describe, expect, it } from "vitest";
import { MODELES_MESSAGES, resteACompleter } from "@/lib/messages-modeles";

// Modèles de messages aux clients : courts, à compléter, jamais publiables tels quels, sans fait hors du registre.

describe("modèles de messages", () => {
  it("cinq modèles, de 5 à 200 caractères, chacun avec au moins un passage à compléter", () => {
    expect(MODELES_MESSAGES.map((m) => m.cle)).toEqual(["fermeture", "vacances", "retard", "zone", "nouveaute"]);
    for (const m of MODELES_MESSAGES) {
      expect(m.texte.length).toBeGreaterThanOrEqual(5);
      expect(m.texte.length).toBeLessThanOrEqual(200);
      expect(resteACompleter(m.texte)).toBe(true);
    }
  });
  it("une fois complété, le texte passe", () => {
    expect(resteACompleter("Le restaurant est en vacances du 22 décembre au 11 janvier. On reprend les commandes le 12 janvier.")).toBe(false);
  });
  it("règles de style de Jérémy : ni virgule avant « et », ni tiret d'incise, ni emoji ; seuls faits du registre", () => {
    for (const { texte } of MODELES_MESSAGES) {
      expect(texte).not.toMatch(/, et /);
      expect(texte).not.toMatch(/ [–—] /);
      expect(texte).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const interdit of ["napolitain", "450", "chêne", "banquet", "tram", "maison"]) expect(texte.toLowerCase()).not.toContain(interdit);
    }
    // Le seul téléphone publié est celui du registre.
    const tels = MODELES_MESSAGES.flatMap((m) => m.texte.match(/0\d{2} \d{3} \d{2} \d{2}/g) ?? []);
    expect(new Set(tels)).toEqual(new Set(["022 792 16 89"]));
  });
});
