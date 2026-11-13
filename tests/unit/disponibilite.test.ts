import { describe, expect, it } from "vitest";
import { dateEnLettres, dispoDe, joursEnLettres, motifDisponibilite } from "@/lib/disponibilite";
import { champsDisponibilite, dateRupture } from "@/lib/gestion-dispo";
import type { Catalogue, PlatCatalogue } from "@/lib/panier";
import { erreurPlatsDuJour } from "@/lib/plat-du-jour";

// Disponibilités d'un plat et rupture planifiée, côté serveur et navigateur (src/lib/disponibilite.ts).
// Le 2026-11-20 est un vendredi. Aucun prix : le contrôle ne lit pas les montants.

const VENDREDI = "2026-11-20";
const midi = (date = VENDREDI, mode?: "livraison" | "retrait") => ({ date, minutes: 12 * 60, service: "midi" as const, mode });
const soir = (date = VENDREDI, mode?: "livraison" | "retrait") => ({ date, minutes: 19 * 60, service: "soir" as const, mode });

describe("textes", () => {
  it("écrit les dates et les jours en toutes lettres", () => {
    expect(dateEnLettres(VENDREDI)).toBe("vendredi 20 novembre");
    expect(dateEnLettres("2027-01-01")).toBe("vendredi 1 janvier");
    expect(joursEnLettres([1])).toBe("le lundi");
    expect(joursEnLettres([6, 5])).toBe("le vendredi et le samedi");
    expect(joursEnLettres([1, 3, 5])).toBe("le lundi, le mercredi et le vendredi");
    expect(joursEnLettres([2, 3, 4, 5, 6])).toBe("du mardi au samedi");
  });
});

describe("motifDisponibilite", () => {
  it("sans restriction ni rupture, tout passe", () => {
    expect(motifDisponibilite({}, midi(), VENDREDI)).toBeNull();
    expect(motifDisponibilite({ dispo: null }, null, VENDREDI)).toBeNull();
  });

  it("service, jours et mode", () => {
    const plat = { dispo: { service: "soir" as const, mode: "retrait" as const, jours: [5, 6] } };
    expect(motifDisponibilite(plat, midi(), VENDREDI)).toBe("Seulement le soir.");
    expect(motifDisponibilite(plat, soir("2026-11-19"), VENDREDI)).toBe("Seulement le vendredi et le samedi.");
    expect(motifDisponibilite(plat, soir(VENDREDI, "livraison"), VENDREDI)).toBe("Seulement à emporter.");
    expect(motifDisponibilite(plat, soir(VENDREDI, "retrait"), VENDREDI)).toBeNull();
    expect(motifDisponibilite({ dispo: { service: "midi", mode: "livraison", jours: null } }, soir(), VENDREDI)).toBe("Seulement à midi.");
    expect(motifDisponibilite({ dispo: { service: null, mode: "livraison", jours: null } }, midi(VENDREDI, "retrait"), VENDREDI)).toBe("Seulement en livraison.");
  });

  it("sans service connu, l'heure décide (avant 15h : midi)", () => {
    const plat = { dispo: { service: "midi" as const, mode: null, jours: null } };
    expect(motifDisponibilite(plat, { date: VENDREDI, minutes: 14 * 60 }, VENDREDI)).toBeNull();
    expect(motifDisponibilite(plat, { date: VENDREDI, minutes: 18 * 60 }, VENDREDI)).toBe("Seulement à midi.");
  });

  it("rupture planifiée : refusée jusqu'à la date comprise, acceptée le lendemain, même sans moment", () => {
    const plat = { rupture_jusqu_au: "2026-11-19" };
    expect(motifDisponibilite(plat, midi("2026-11-19"), "2026-11-17")).toBe("Épuisé. De retour le vendredi 20 novembre.");
    expect(motifDisponibilite(plat, midi(VENDREDI), "2026-11-17")).toBeNull();
    expect(motifDisponibilite(plat, null, "2026-11-17")).toBe("Épuisé. De retour le vendredi 20 novembre.");
    expect(motifDisponibilite(plat, null, VENDREDI)).toBeNull();
  });
});

describe("lecture de la base", () => {
  it("toute valeur inconnue vaut « sans restriction »", () => {
    expect(dispoDe({})).toBeNull();
    expect(dispoDe({ dispo_service: "nuit", dispo_mode: "drone", dispo_jours: [] })).toBeNull();
    expect(dispoDe({ dispo_service: "soir", dispo_jours: [5, 9] })).toEqual({ service: "soir", mode: null, jours: [5] });
  });
});

describe("au panier et au paiement", () => {
  const plat = (p: Partial<PlatCatalogue>): PlatCatalogue => ({
    slug: "essai",
    nom: "Burrata d'essai",
    categorie_slug: "entrees",
    prix_centimes: 0,
    prix_a_valider: false,
    station: "cuisine",
    rupture_motif: null,
    groupes: [],
    retraits: [],
    ...p,
  });
  const catalogue = (p: Partial<PlatCatalogue>): Catalogue => ({ plats: { essai: plat(p) }, groupes: {}, tauxTvaPourcent: 0 });

  it("nomme le plat refusé", () => {
    const c = catalogue({ dispo: { service: null, mode: "retrait", jours: null } });
    expect(erreurPlatsDuJour(c, [{ slug: "essai" }], midi(VENDREDI, "livraison"), VENDREDI)).toBe("Burrata d'essai : seulement à emporter.");
    expect(erreurPlatsDuJour(c, [{ slug: "essai" }], midi(VENDREDI, "retrait"), VENDREDI)).toBeNull();
  });

  it("une rupture planifiée bloque aussi un panier sans créneau", () => {
    const c = catalogue({ rupture_jusqu_au: VENDREDI });
    expect(erreurPlatsDuJour(c, [{ slug: "essai" }], null, VENDREDI)).toBe("Burrata d'essai : épuisé. De retour le samedi 21 novembre.");
  });

  it("le plat du jour garde sa règle", () => {
    const c = catalogue({ jour: { date: VENDREDI, service: "midi" } });
    expect(erreurPlatsDuJour(c, [{ slug: "essai" }], soir(), VENDREDI)).toBe("Burrata d'essai : seulement à midi.");
    expect(erreurPlatsDuJour(c, [{ slug: "inconnu" }], soir(), VENDREDI)).toBeNull();
  });
});

describe("saisie du back-office", () => {
  it("disponibilités", () => {
    expect(champsDisponibilite({ service: "soir", mode: null, jours: [6, 5, 5] })).toEqual({ ok: true, valeur: { service: "soir", mode: null, jours: [5, 6] } });
    expect(champsDisponibilite({ jours: [1, 2, 3, 4, 5, 6, 7] })).toEqual({ ok: true, valeur: { service: null, mode: null, jours: null } });
    expect(champsDisponibilite({ jours: [] })).toMatchObject({ ok: false });
    expect(champsDisponibilite({ jours: [0] })).toMatchObject({ ok: false });
    expect(champsDisponibilite({ service: "nuit" })).toMatchObject({ ok: false });
    expect(champsDisponibilite({ mode: "drone" })).toMatchObject({ ok: false });
    expect(champsDisponibilite([])).toMatchObject({ ok: false });
  });

  it("date de retour", () => {
    expect(dateRupture(null, VENDREDI)).toEqual({ ok: true, valeur: null });
    expect(dateRupture(VENDREDI, VENDREDI)).toEqual({ ok: true, valeur: VENDREDI });
    expect(dateRupture("2027-01-19", VENDREDI)).toEqual({ ok: true, valeur: "2027-01-19" });
    expect(dateRupture("2027-01-20", VENDREDI)).toMatchObject({ ok: false });
    expect(dateRupture("2026-11-19", VENDREDI)).toMatchObject({ ok: false });
    expect(dateRupture("20/11/2026", VENDREDI)).toMatchObject({ ok: false });
    expect(dateRupture(20261120, VENDREDI)).toMatchObject({ ok: false });
  });
});
