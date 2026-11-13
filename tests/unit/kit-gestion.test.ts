import { describe, expect, it } from "vitest";
import { celluleCsv, documentCsv, nomFichierCsv } from "@/components/gestion/ui/csv";
import { ecartPourcent, ecartTexte, montant, nombre } from "@/components/gestion/ui/format";
import { decalerJour, dureeJours, periodeComparaison, periodeDe, raccourciDe, verifierPeriode } from "@/components/gestion/ui/periodes";

// Kit du back-office (vague 3) : la logique sans écran. Les composants sont testés dans tests/e2e/gestion-kit.spec.ts.
describe("csv", () => {
  it("neutralise les formules mais garde les nombres négatifs", () => {
    expect(celluleCsv("=SOMME(A1)")).toBe("'=SOMME(A1)");
    expect(celluleCsv("+41 79 000 00 00")).toBe("'+41 79 000 00 00");
    expect(celluleCsv("@pirate")).toBe("'@pirate");
    expect(celluleCsv("-12.50")).toBe("-12.50");
    expect(celluleCsv(-3)).toBe("-3");
  });
  it("met entre guillemets ce qui contient ; \" ou un retour à la ligne", () => {
    expect(celluleCsv('Pizza "La Ferme"; grande')).toBe('"Pizza ""La Ferme""; grande"');
    expect(celluleCsv("deux\nlignes")).toBe('"deux\nlignes"');
    expect(celluleCsv(null)).toBe("");
  });
  it("produit un document lisible par Excel en Suisse", () => {
    expect(documentCsv([["Numéro", "Total"], [37, "21.50"]])).toBe("﻿Numéro;Total\r\n37;21.50\r\n");
    expect(nomFichierCsv("Commandes du jour", "2026-11-13")).toBe("la-ferme-commandes-du-jour-2026-11-13.csv");
    expect(nomFichierCsv("Équipe / accès", "2026-11-13")).toBe("la-ferme-equipe-acces-2026-11-13.csv");
  });
});

describe("format", () => {
  it("écrit les nombres à la suisse", () => {
    expect(nombre(1234)).toBe("1’234");
    expect(montant(123450)).toBe("1’234.50");
    expect(montant(-500)).toBe("-5.00");
  });
  it("calcule l'écart et l'écrit avec son signe", () => {
    expect(ecartPourcent(112, 100)).toBe(12);
    expect(ecartPourcent(97, 100)).toBe(-3);
    expect(ecartPourcent(5, 0)).toBeNull();
    expect(ecartTexte(12)).toBe("+12 %");
    expect(ecartTexte(-3)).toBe("−3 %");
    expect(ecartTexte(0)).toBe("=");
  });
});

describe("périodes", () => {
  const auj = "2026-03-31";
  it("donne les raccourcis, mois de février et fin de mois compris", () => {
    expect(periodeDe("hier", auj)).toEqual({ debut: "2026-03-30", fin: "2026-03-30" });
    expect(periodeDe("7jours", auj)).toEqual({ debut: "2026-03-25", fin: auj });
    expect(periodeDe("mois", auj)).toEqual({ debut: "2026-03-01", fin: auj });
    expect(periodeDe("mois-dernier", auj)).toEqual({ debut: "2026-02-01", fin: "2026-02-28" });
    expect(periodeDe("mois-dernier", "2026-01-15")).toEqual({ debut: "2025-12-01", fin: "2025-12-31" });
  });
  it("traverse le passage à l'heure d'été sans perdre de jour", () => {
    expect(decalerJour("2026-03-29", 1)).toBe("2026-03-30");
    expect(dureeJours({ debut: "2026-03-28", fin: "2026-03-30" })).toBe(3);
  });
  it("compare un jour au même jour de la semaine passée, une période à celle d'avant", () => {
    expect(periodeComparaison({ debut: "2026-11-13", fin: "2026-11-13" })).toEqual({ debut: "2026-11-06", fin: "2026-11-06" });
    expect(periodeComparaison({ debut: "2026-11-07", fin: "2026-11-13" })).toEqual({ debut: "2026-10-31", fin: "2026-11-06" });
  });
  it("reconnaît un raccourci et refuse une période fausse", () => {
    expect(raccourciDe({ debut: "2026-03-01", fin: auj }, auj)).toBe("mois");
    expect(raccourciDe({ debut: "2026-03-03", fin: auj }, auj)).toBeNull();
    expect(verifierPeriode({ debut: "2026-03-05", fin: "2026-03-01" })).toMatch(/début est après/);
    expect(verifierPeriode({ debut: "2026-02-30", fin: "2026-03-01" })).toBe("Choisissez deux dates.");
    expect(verifierPeriode({ debut: "2025-01-01", fin: "2026-03-01" })).toMatch(/366 jours/);
    expect(verifierPeriode({ debut: "2026-03-01", fin: "2026-03-05" })).toBeNull();
  });
});
