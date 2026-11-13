import { beforeAll, describe, expect, it } from "vitest";
import { calendrier, feriesAConfirmer, feriesGeneve, jourCalendrier, paques } from "@/lib/calendrier";
import { chargerConfigService } from "@/lib/config-service";
import type { ConfigService } from "@/lib/service";

// Calendrier du back-office : fériés genevois (rsGE J 1 45, art. 1) et jours vus par le client, sur la config
// de la base embarquée (horaires du mardi au samedi, fermeture annuelle du 22.12.2026 au 11.01.2027).

let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});

describe("fériés genevois", () => {
  it("Pâques", () => {
    expect(paques(2024)).toBe("2024-03-31");
    expect(paques(2025)).toBe("2025-04-20");
    expect(paques(2026)).toBe("2026-04-05");
    expect(paques(2027)).toBe("2027-03-28");
  });

  it("les neuf jours de 2026", () => {
    expect(feriesGeneve(2026)).toEqual([
      { date: "2026-01-01", nom: "Nouvel An" },
      { date: "2026-04-03", nom: "Vendredi saint" },
      { date: "2026-04-06", nom: "Lundi de Pâques" },
      { date: "2026-05-14", nom: "Ascension" },
      { date: "2026-05-25", nom: "Lundi de Pentecôte" },
      { date: "2026-08-01", nom: "Fête nationale" },
      { date: "2026-09-10", nom: "Jeûne genevois" },
      { date: "2026-12-25", nom: "Noël" },
      { date: "2026-12-31", nom: "Restauration de la République" },
    ]);
  });

  it("Jeûne genevois : le jeudi qui suit le premier dimanche de septembre", () => {
    expect(feriesGeneve(2025).find((f) => f.nom === "Jeûne genevois")?.date).toBe("2025-09-11");
    // 1er septembre 2024 : un dimanche.
    expect(feriesGeneve(2024).find((f) => f.nom === "Jeûne genevois")?.date).toBe("2024-09-05");
  });
});

describe("jour vu par le client", () => {
  it("un mardi ordinaire : midi et soir aux heures habituelles", () => {
    const j = jourCalendrier(config, "2026-11-17");
    expect(j.services).toEqual([
      { service: "midi", ouvert: true, premiere_heure: "11:45", derniere_heure: "13:45", source: "habituel" },
      { service: "soir", ouvert: true, premiere_heure: "18:45", derniere_heure: "22:45", source: "habituel" },
    ]);
  });

  it("un dimanche : pas de service ; pendant la fermeture annuelle : fermé avec son motif", () => {
    expect(jourCalendrier(config, "2026-11-15").services.map((s) => s.source)).toEqual(["pas-de-service", "pas-de-service"]);
    expect(jourCalendrier(config, "2026-12-22").services).toEqual([
      { service: "midi", ouvert: false, source: "fermeture", motif: "Fermeture annuelle" },
      { service: "soir", ouvert: false, source: "fermeture", motif: "Fermeture annuelle" },
    ]);
  });

  it("ouverture exceptionnelle et fermeture d'un seul service", () => {
    const c: ConfigService = {
      ...config,
      ouvertures: [{ jour: "2026-11-15", service: "soir", premiere_heure: "18:00", derniere_heure: "22:00", derniere_commande: "21:30", derniere_commande_pizzas: "21:45" }],
      fermetures: [...config.fermetures, { debut: "2026-11-17", fin: "2026-11-17", motif: "Mariage", service: "soir" }],
    };
    expect(jourCalendrier(c, "2026-11-15").services[1]).toEqual({ service: "soir", ouvert: true, premiere_heure: "18:00", derniere_heure: "22:00", source: "ouverture" });
    expect(jourCalendrier(c, "2026-11-17").services).toEqual([
      { service: "midi", ouvert: true, premiere_heure: "11:45", derniere_heure: "13:45", source: "habituel" },
      { service: "soir", ouvert: false, source: "fermeture", motif: "Mariage" },
    ]);
  });

  it("le calendrier nomme les fériés", () => {
    const j = calendrier(config, "2026-12-24", "2026-12-26");
    expect(j.map((x) => [x.date, x.ferie])).toEqual([
      ["2026-12-24", null],
      ["2026-12-25", "Noël"],
      ["2026-12-26", null],
    ]);
  });
});

describe("fériés à confirmer", () => {
  it("seulement ceux où le restaurant serait ouvert, hors fermeture annuelle", () => {
    expect(feriesAConfirmer(config, "2026-11-13", "2027-12-31")).toEqual([
      { date: "2027-03-26", nom: "Vendredi saint", services: ["midi", "soir"] },
      { date: "2027-05-06", nom: "Ascension", services: ["midi", "soir"] },
      { date: "2027-09-09", nom: "Jeûne genevois", services: ["midi", "soir"] },
      { date: "2027-12-25", nom: "Noël", services: ["midi", "soir"] },
      { date: "2027-12-31", nom: "Restauration de la République", services: ["midi", "soir"] },
    ]);
  });
});
