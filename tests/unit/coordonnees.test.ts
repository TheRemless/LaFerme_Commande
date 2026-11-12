import { describe, expect, it } from "vitest";
import { champClientInvalide, telephoneValide } from "@/lib/validation";

// Rapport client mystère, CM-09 : dire quel champ est faux, et le contrôler avant l'envoi.
describe("coordonnées", () => {
  it("reconnaît un téléphone suisse ou international", () => {
    expect(telephoneValide("079 000 00 00")).toBe(true);
    expect(telephoneValide("+41 79 000 00 01")).toBe(true);
    expect(telephoneValide("0790000003")).toBe(true);
    expect(telephoneValide("abc")).toBe(false);
    expect(telephoneValide("079 000")).toBe(false);
  });
  it("nomme le premier champ faux", () => {
    const bon = { prenom: "A", nom: "B", telephone: "079 000 00 00", email: "a@b.ch" };
    expect(champClientInvalide(bon)).toBeNull();
    expect(champClientInvalide({ ...bon, telephone: "abc" })).toBe("telephone");
    expect(champClientInvalide({ ...bon, email: "a@" })).toBe("email");
    expect(champClientInvalide({ ...bon, prenom: " " })).toBe("prenom");
  });
});
