import { describe, expect, it } from "vitest";
import { auteur, evenementTexte } from "@/components/gestion/commandes/libelles";

// Libellés de la chronologie d'une commande au back-office (vague 3, bo-commandes).
describe("chronologie d'une commande", () => {
  it("lit l'heure telle que Postgres l'écrit", () => {
    const t = evenementTexte({ type: "statut", le: "2026-11-13T18:00:00Z", de: "nouvelle", vers: "acceptee", detail: "2026-11-13 18:30:00+00" });
    expect(t).toEqual({ titre: "Acceptée", detail: "pour 19:30" });
    expect(evenementTexte({ type: "statut", le: "x", de: "acceptee", vers: "acceptee", detail: "heure 2026-11-13 19:00:00+00" })).toEqual({ titre: "Heure changée", detail: "pour 20:00" });
  });
  it("nomme les modifications, recréations, e-mails bloqués et remboursements", () => {
    expect(evenementTexte({ type: "statut", le: "x", de: "acceptee", vers: "acceptee", detail: "modifiee client_telephone, details_livraison" }).detail).toBe("téléphone, consignes de livraison");
    expect(evenementTexte({ type: "statut", le: "x", de: null, vers: "courriel_non_envoye", detail: "prete" }).titre).toBe("E-mail non envoyé (limite du jour)");
    expect(evenementTexte({ type: "remboursement", le: "x", montant_centimes: 1500, motif: "Froid.", statut: "fait" })).toEqual({ titre: "Remboursement de CHF 15.00", detail: "Froid. (fait)" });
  });
  it("écrit l'auteur en clair", () => {
    expect(auteur("tablette:Léa")).toBe("Léa (tablette)");
    expect(auteur("gestion:Gérant")).toBe("Gérant (back-office)");
    expect(auteur("client")).toBe("le client");
  });
});
