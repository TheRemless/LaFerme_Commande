import { describe, expect, it } from "vitest";
import { ascii, ecrituresCresus, fichierCresus, validerPlan, type LigneCresus } from "@/lib/export-cresus";

// Fichier d'écritures pour Crésus Comptabilité, format simple du manuel (§ 19.2) : src/lib/export-cresus.ts.

const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800" };
const ligne = (l: Partial<LigneCresus>): LigneCresus => ({
  jour: "2026-12-04", taux_tva_pourcent: 2.6, sorte: "vente", moyen: "stripe", nombre: 1,
  ttc_centimes: 0, tva_centimes: 0, frais_centimes: 0, tva_frais_centimes: 0, ...l,
});

describe("écritures Crésus", () => {
  it("une vente en ligne avec livraison : ventes HT, livraison HT et TVA au crédit, Stripe au débit ; la somme vaut le TTC", () => {
    const r = ecrituresCresus([ligne({ ttc_centimes: 5130, tva_centimes: 130, frais_centimes: 490, tva_frais_centimes: 12 })], COMPTES);
    expect(r).toEqual({
      ok: true,
      ecritures: [
        { date: "04.12.2026", debit: "1090", credit: "3200", libelle: "Ventes en ligne HT", centimes: 4522 },
        { date: "04.12.2026", debit: "1090", credit: "3400", libelle: "Frais de livraison en ligne HT", centimes: 478 },
        { date: "04.12.2026", debit: "1090", credit: "2200", libelle: "TVA 2.6% ventes en ligne", centimes: 130 },
      ],
    });
  });

  it("un remboursement : remboursements HT et TVA au débit, le moyen au crédit ; rien pour un montant nul", () => {
    const r = ecrituresCresus([ligne({ sorte: "remboursement", moyen: "caisse", ttc_centimes: 1026, tva_centimes: 26 }), ligne({ moyen: "terminal" })], COMPTES);
    expect(r.ok && r.ecritures).toEqual([
      { date: "04.12.2026", debit: "3800", credit: "1000", libelle: "Remboursements comptoir especes HT", centimes: 1000 },
      { date: "04.12.2026", debit: "2200", credit: "1000", libelle: "TVA 2.6% remboursements comptoir especes", centimes: 26 },
    ]);
  });

  it("refuse une période à deux taux : un seul compte de ventes", () => {
    const r = ecrituresCresus([ligne({ ttc_centimes: 100 }), ligne({ taux_tva_pourcent: 8.1, ttc_centimes: 100 })], COMPTES);
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining("2.6 % et 8.1 %") });
  });

  it("fichier : six champs à la tabulation, pièce vide, CR+LF, ASCII seul, montant à point sans milliers", () => {
    const f = fichierCresus([{ date: "04.12.2026", debit: "1090", credit: "3200", libelle: "Ventes éàç\tHT\n", centimes: 123456 }]);
    expect(f).toBe("04.12.2026\t1090\t3200\t\tVentes eacHT\t1234.56\r\n");
    expect(/^[\x09\x0A\x0D\x20-\x7E]*$/.test(f)).toBe(true);
    expect(ascii("Réglage – à l'emporter")).toBe("Reglage  a l'emporter");
  });
});

describe("plan de comptes envoyé par l'écran", () => {
  it("garde sept comptes en chiffres, tous différents", () => {
    expect(validerPlan({ ...COMPTES, caisse: " 1000 " })).toEqual({ ok: true, comptes: COMPTES });
    expect(validerPlan({ ...COMPTES, caisse: "" })).toMatchObject({ ok: false, erreur: expect.stringContaining("Caisse") });
    expect(validerPlan({ ...COMPTES, tva: "22.00" })).toMatchObject({ ok: false });
    expect(validerPlan({ ...COMPTES, terminal: "1090" })).toEqual({ ok: false, erreur: "Deux rôles ont le même compte." });
    expect(validerPlan({ ...COMPTES, autre: "1" })).toMatchObject({ ok: false });
    expect(validerPlan(null)).toMatchObject({ ok: false });
  });
});
