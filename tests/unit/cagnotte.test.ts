import { describe, expect, it } from "vitest";
import { cagnotteUtilisable, messageAjustement, messageCagnotte, montantCagnotte } from "@/lib/cagnotte";
import { courrielRappelCagnotte } from "@/lib/courriel/modeles";

// Cagnotte (vague 3) : aperçu au panier, refus de la base en mots, e-mail de rappel avant expiration.

describe("cagnotte côté serveur", () => {
  it("aperçu : rien sous le seuil, au plus le solde et les plats, CHF 0.50 restent à payer", () => {
    expect(cagnotteUtilisable(900, 1000, 3600, 3600)).toBe(0);
    expect(cagnotteUtilisable(1500, 1000, 3600, 4100)).toBe(1500);
    expect(cagnotteUtilisable(5000, 1000, 3600, 4100)).toBe(3600);
    expect(cagnotteUtilisable(5000, 1000, 1200, 1200)).toBe(1150);
  });

  it("montant demandé : un entier positif, sinon rien", () => {
    expect(montantCagnotte(1500)).toBe(1500);
    expect([montantCagnotte(-1), montantCagnotte(1.5), montantCagnotte("1500"), montantCagnotte(2_000_000)]).toEqual([0, 0, 0, 0]);
  });

  it("refus de la base en mots pour le client et le gérant", () => {
    expect(messageCagnotte(new Error("cagnotte_refusee:comptoir"))).toBe("La cagnotte s'utilise avec le paiement en ligne.");
    expect(messageCagnotte(new Error("autre chose"))).toBeNull();
    expect(messageAjustement(new Error("ajustement_refuse:negatif"))).toBe("Le retrait dépasse le solde de la cagnotte.");
  });

  it("rappel 30 jours avant : solde, date, seuil et lien pour le couper, sans donnée dans les liens", () => {
    const m = courrielRappelCagnotte({ prenom: "Léa", solde_centimes: 740, expire_le: "2027-12-12", seuil_centimes: 1000 }, "https://commande.exemple.test");
    expect(m.type).toBe("rappel_cagnotte");
    expect(m.sujet).toBe("Votre cagnotte La Ferme expire le 12 décembre 2027");
    expect(m.texte).toContain("Vous avez CHF 7.40 dans votre cagnotte La Ferme. Elle expire le 12 décembre 2027, un an après votre dernière commande.");
    expect(m.texte).toContain("dès CHF 10.00");
    expect(m.texte).toContain("https://commande.exemple.test/compte");
    expect(m.html).not.toMatch(/\?.*=/);
  });
});
