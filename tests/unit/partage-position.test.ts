import { describe, expect, it } from "vitest";
import { envoyerMaintenant, INTERVALLE_POSITION_MS } from "@/components/livreur/partage-position";

// Rythme d'envoi de la position depuis le téléphone du livreur.
describe("envoi de la position", () => {
  it("la première, à chaque changement d'arrêt, puis toutes les 20 secondes", () => {
    expect(envoyerMaintenant(null, "a", 1000)).toBe(true);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "a", 1000 + INTERVALLE_POSITION_MS - 1)).toBe(false);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "a", 1000 + INTERVALLE_POSITION_MS)).toBe(true);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "b", 1001)).toBe(true);
  });
});
