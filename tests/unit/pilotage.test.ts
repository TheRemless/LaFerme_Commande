import { describe, expect, it } from "vitest";
import { bornes, ecart, jourDeService, lireDemande, serviceDe } from "@/lib/pilotage";

const q = (s: string) => new URLSearchParams(s);

describe("périodes du tableau des ventes", () => {
  it("le jour de service change à 5h à Genève", () => {
    expect(jourDeService(new Date("2026-12-05T03:30:00Z"))).toBe("2026-12-04"); // 4h30 à Genève
    expect(jourDeService(new Date("2026-12-05T04:30:00Z"))).toBe("2026-12-05"); // 5h30
    expect(jourDeService(new Date("2026-07-05T02:30:00Z"))).toBe("2026-07-04"); // 4h30 en été
  });

  it("semaine du lundi au dimanche, mois comparé au mois civil précédent", () => {
    expect(bornes("jour", "2026-12-04")).toEqual({ debut: "2026-12-04", fin: "2026-12-04" });
    expect(bornes("semaine", "2026-12-04")).toEqual({ debut: "2026-11-30", fin: "2026-12-06" });
    expect(bornes("semaine", "2026-12-06")).toEqual({ debut: "2026-11-30", fin: "2026-12-06" });
    expect(bornes("semaine", "2026-11-30")).toEqual({ debut: "2026-11-30", fin: "2026-12-06" });
    expect(bornes("mois", "2026-03-15")).toEqual({
      debut: "2026-03-01",
      fin: "2026-03-31",
      comparaison: { debut: "2026-02-01", fin: "2026-02-28" },
    });
    expect(bornes("mois", "2027-01-10").comparaison).toEqual({ debut: "2026-12-01", fin: "2026-12-31" });
  });

  it("lit les paramètres et refuse ce qui ne va pas", () => {
    expect(lireDemande(q(""), "2026-12-04")).toEqual({ debut: "2026-12-04", fin: "2026-12-04" });
    expect(lireDemande(q("periode=semaine&jour=2026-12-04"))).toEqual({ debut: "2026-11-30", fin: "2026-12-06" });
    expect(lireDemande(q("periode=choisie&debut=2026-12-01&fin=2026-12-10"))).toEqual({ debut: "2026-12-01", fin: "2026-12-10" });
    expect(lireDemande(q("periode=choisie&debut=2026-12-01&fin=2026-12-10&comp_debut=2025-12-01&comp_fin=2025-12-10"))).toEqual({
      debut: "2026-12-01",
      fin: "2026-12-10",
      comparaison: { debut: "2025-12-01", fin: "2025-12-10" },
    });
    for (const s of [
      "periode=annee",
      "periode=jour&jour=demain",
      "periode=choisie&debut=2026-12-10&fin=2026-12-01",
      "periode=choisie&debut=2025-01-01&fin=2026-12-31",
      "periode=choisie&debut=2026-12-01&fin=2026-12-10&comp_debut=2025-12-01",
    ]) {
      expect(lireDemande(q(s)), s).toBeNull();
    }
  });

  it("lit le service et devine le service en cours", () => {
    expect(lireDemande(q("periode=jour&jour=2026-12-04&service=soir"))).toEqual({ debut: "2026-12-04", fin: "2026-12-04", service: "soir" });
    expect(lireDemande(q("periode=jour&jour=2026-12-04&service=nuit"))).toBeNull();
    expect(serviceDe(new Date("2026-12-04T11:00:00Z"))).toBe("midi"); // 12h à Genève
    expect(serviceDe(new Date("2026-12-04T14:00:00Z"))).toBe("soir"); // 15h
    expect(serviceDe(new Date("2026-12-05T01:00:00Z"))).toBe("soir"); // 2h : encore le soir de la veille
  });

  it("écart en pour cent, sans division par zéro", () => {
    expect(ecart(120, 100)).toBe(20);
    expect(ecart(80, 100)).toBe(-20);
    expect(ecart(5, 0)).toBeNull();
  });
});
