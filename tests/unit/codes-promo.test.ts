import { describe, expect, it } from "vitest";
import { champsCode, codeSaisi, messageRefus } from "@/lib/codes-promo";

// Codes promo côté serveur : saisie du back-office et texte des refus. Montants d'essai seulement.

describe("texte des refus", () => {
  it("un texte par raison, aucun quand le module est désactivé", () => {
    expect(messageRefus({ raison: "desactive" })).toBeNull();
    expect(messageRefus({ raison: "inconnu" })).toBe("Ce code n'existe pas. Vérifiez l'orthographe.");
    for (const r of ["inactif", "expire", "plafond"] as const) expect(messageRefus({ raison: r })).toBe("Ce code n'est plus valable.");
    expect(messageRefus({ raison: "minimum", minimum_centimes: 1234 })).toBe("Ce code vaut à partir de CHF 12.34 de plats.");
    expect(messageRefus({ raison: "deja_utilise" })).toBe("Vous avez déjà utilisé ce code.");
    expect(messageRefus({ raison: "retrait" })).toBe("Ce code vaut pour une livraison.");
  });
});

describe("saisie", () => {
  it("le code tapé par le client", () => {
    expect(codeSaisi(" flyer-26 ")).toBe("FLYER-26");
    expect(codeSaisi("fl yer")).toBe("FLYER");
    expect(codeSaisi("ab")).toBeNull();
    expect(codeSaisi("é@!")).toBeNull();
    expect(codeSaisi(42)).toBeNull();
  });

  it("un code neuf naît inactif et exige code, support, type et valeur", () => {
    expect(champsCode({ code: "essai", libelle: " Flyer  automne ", type: "pourcentage", valeur: 10, actif: true }, true)).toEqual({
      ok: true, valeur: { code: "ESSAI", libelle: "Flyer automne", type: "pourcentage", valeur: 10 },
    });
    expect(champsCode({ code: "ESSAI", libelle: "X", type: "livraison", valeur: 5 }, true)).toMatchObject({ ok: true, valeur: { valeur: null } });
    expect(champsCode({ code: "ESSAI", libelle: "X", type: "pourcentage", valeur: 101 }, true)).toMatchObject({ ok: false });
    expect(champsCode({ code: "ESSAI", libelle: "X", type: "montant", valeur: 0 }, true)).toMatchObject({ ok: false });
    expect(champsCode({ code: "ESSAI", libelle: "", type: "montant", valeur: 1 }, true)).toMatchObject({ ok: false });
    expect(champsCode({ code: "ESSAI", libelle: "X", type: "montant", valeur: 1, debut: "2026-12-31", fin: "2026-12-01" }, true)).toMatchObject({ ok: false });
  });

  it("une modification ne prend que les champs donnés, y compris l'activation", () => {
    expect(champsCode({ actif: true }, false)).toEqual({ ok: true, valeur: { actif: true } });
    expect(champsCode({ fin: null, plafond_utilisations: null }, false)).toEqual({ ok: true, valeur: { fin: null, plafond_utilisations: null } });
    expect(champsCode({ actif: "oui" }, false)).toMatchObject({ ok: false });
    expect(champsCode({ plafond_utilisations: 0 }, false)).toMatchObject({ ok: false });
  });
});
