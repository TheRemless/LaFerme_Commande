import { describe, expect, it } from "vitest";
import { ascii, ecrituresCresus, ecrituresEtendues, fichierCresus, fichierCresusEtendu, validerPlan, windows1252, type LigneCresus } from "@/lib/export-cresus";

// Fichier d'écritures pour Crésus Comptabilité, format simple du manuel (§ 19.2) : src/lib/export-cresus.ts.

const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
const CODES = { "2.6": "TVARED", "8.1": "TVA" };
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
  it("garde neuf comptes en chiffres, tous différents, et des codes TVA courts", () => {
    const plan = (comptes: unknown, codes: unknown = CODES) => validerPlan({ comptes, codes_tva: codes });
    expect(plan({ ...COMPTES, caisse: " 1000 " })).toEqual({ ok: true, plan: { comptes: COMPTES, codes_tva: CODES } });
    expect(plan({ ...COMPTES, caisse: "" })).toMatchObject({ ok: false, erreur: expect.stringContaining("Caisse") });
    expect(plan({ ...COMPTES, tva: "22.00" })).toMatchObject({ ok: false });
    expect(plan({ ...COMPTES, terminal: "1090" })).toEqual({ ok: false, erreur: "Deux rôles ont le même compte." });
    expect(plan({ ...COMPTES, autre: "1" })).toMatchObject({ ok: false });
    expect(plan(COMPTES, { "2.6": "TVA RED" })).toMatchObject({ ok: false, erreur: expect.stringContaining("Code TVA 2,6 %") });
    expect(plan(COMPTES, {})).toEqual({ ok: true, plan: { comptes: COMPTES, codes_tva: { "2.6": "", "8.1": "" } } });
    expect(validerPlan(null)).toMatchObject({ ok: false });
    expect(validerPlan(COMPTES)).toMatchObject({ ok: false });
  });
});

describe("format étendu avec la TVA", () => {
  const vente = { jour: "2026-12-04", moyen: "stripe" as const, taux: 2.6, nombre: 1, ttc: 5130, tva: 130, frais_ttc: 490, frais_tva: 12, rabais_ttc: 500, rabais_tva: 13, cagnotte_ttc: 0, cagnotte_tva: 0 };

  it("trois lignes par écriture multiple, brut et rabais à part, TTC sur le compte du moyen", () => {
    const r = ecrituresEtendues({ ventes: [vente], avoirs: [] }, { comptes: COMPTES, codes_tva: CODES });
    if (!r.ok) throw new Error(r.erreur);
    expect(r.lignes.map((l) => [l.multiple, l.debit, l.credit, l.centimes, l.code])).toEqual([
      // Ventes au brut : 5130 - 490 + 500 = 5140 TTC, TVA 130 - 12 + 13 = 131.
      [1, "…", "3200", 5009, "TVARED"],
      [1, "…", "2200", 131, "TVARED"],
      [1, "1090", "…", 5140, "TVARED"],
      [2, "…", "3400", 478, "TVARED"],
      [2, "…", "2200", 12, "TVARED"],
      [2, "1090", "…", 490, "TVARED"],
      [3, "3801", "…", 487, "TVARED"],
      [3, "2200", "…", 13, "TVARED"],
      [3, "…", "1090", 500, "TVARED"],
    ]);
  });

  it("un avoir par remboursement, au débit des remboursements, avec son numéro et la référence Stripe", () => {
    const r = ecrituresEtendues(
      { ventes: [], avoirs: [{ numero_avoir: 7, jour: "2026-12-05", moyen: "terminal", commande: 42, stripe_refund_id: null, ventilation: [{ taux: 2.6, ttc: 1026, tva: 26 }] }] },
      { comptes: COMPTES, codes_tva: CODES },
    );
    if (!r.ok) throw new Error(r.erreur);
    expect(r.lignes.map((l) => [l.debit, l.credit, l.centimes])).toEqual([["3800", "…", 1000], ["2200", "…", 26], ["…", "1091", 1026]]);
    expect(r.lignes[0].libelle).toBe("Avoir 7, commande 42, 2,6 % comptoir carte");
  });

  it("refuse une période vide : rien à importer", () => {
    expect(ecrituresEtendues({ ventes: [], avoirs: [] }, { comptes: COMPTES, codes_tva: CODES })).toEqual({ ok: false, erreur: expect.stringContaining("rien à importer") });
  });

  it("refuse sans code TVA pour un taux présent", () => {
    const r = ecrituresEtendues({ ventes: [vente], avoirs: [] }, { comptes: COMPTES, codes_tva: { "2.6": "", "8.1": "TVA" } });
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining("Code TVA du taux 2,6 % manquant") });
  });

  it("fichier : seize champs, tabulation, CR+LF, Windows-1252 avec « … » en 0x85", () => {
    const r = ecrituresEtendues({ ventes: [{ ...vente, frais_ttc: 0, frais_tva: 0, rabais_ttc: 0, rabais_tva: 0 }], avoirs: [] }, { comptes: COMPTES, codes_tva: CODES });
    if (!r.ok) throw new Error(r.erreur);
    const octets = fichierCresusEtendu(r.lignes);
    const texte = Buffer.from(octets).toString("latin1");
    const lignes = texte.split("\r\n").filter(Boolean);
    expect(lignes).toHaveLength(3);
    expect(lignes[0].split("\t")).toEqual(["04.12.2026", "\x85", "3200", "", "Ventes 2,6 % en ligne", "50.00", "0", "0", "1", "1", "1", "1", "TVARED", "Ventes 2,6 % en ligne", "", ""]);
    expect(texte.endsWith("\r\n")).toBe(true);
    // « ő » perd son accent, « Ω » n'a pas d'équivalent : retiré.
    expect(Array.from(windows1252("é…’€őΩ"))).toEqual([0xe9, 0x85, 0x92, 0x80, 0x6f]);
  });
});
