import { describe, expect, it } from "vitest";
import { plageTexte } from "@/lib/plage-heure";

// Vague 3, client-commande : l'heure annoncée en fourchette.
describe("plage d'heure", () => {
  it("fourchette : entre deux heures", () => {
    expect(plageTexte({ basse: 1175, haute: 1190 })).toBe("entre 19h35 et 19h50");
  });
  it("largeur nulle : une seule heure", () => {
    expect(plageTexte({ basse: 1180, haute: 1180 })).toBe("vers 19h40");
  });
});
