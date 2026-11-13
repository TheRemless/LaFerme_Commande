import { describe, expect, it } from "vitest";
import { estDiffere, texteGeste } from "@/components/tablette/differe";

// Retour arrière (P0) : quels gestes attendent 5 secondes avec « Annuler », et ce que dit la barre.
describe("gestes différés", () => {
  it("statut et encaissement attendent ; accepter, refuser et l'heure partent tout de suite", () => {
    expect(estDiffere({ action: "statut", vers: "prete" })).toBe(true);
    expect(estDiffere({ action: "encaisser", moyen: "especes" })).toBe(true);
    expect(estDiffere({ action: "retiree_payee", moyen: "carte" })).toBe(true);
    for (const action of ["accepter", "refuser", "heure", "manque", "imprimer"]) expect(estDiffere({ action })).toBe(false);
  });

  it("texte du geste, comme sur le bouton", () => {
    expect(texteGeste({ action: "statut", vers: "prete" }, "retrait")).toBe("Prête au comptoir");
    expect(texteGeste({ action: "statut", vers: "partie" }, "livraison")).toBe("Partie en livraison");
    expect(texteGeste({ action: "statut", vers: "terminee" }, "livraison")).toBe("Livrée");
    expect(texteGeste({ action: "statut", vers: "terminee" }, "retrait")).toBe("Retirée");
    expect(texteGeste({ action: "retiree_payee", moyen: "especes" }, "retrait")).toBe("Retirée, encaissée en espèces");
    expect(texteGeste({ action: "encaisser", moyen: "carte" }, "retrait")).toBe("Encaissée par carte");
  });
});
