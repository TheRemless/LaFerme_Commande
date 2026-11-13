import { describe, expect, it } from "vitest";
import { fourchette, lireCharge, lireFourchette, raisonCharge } from "@/lib/heure-reelle";
import { etatService, type Charge, type ConfigService } from "@/lib/service";

const CHARGE: Charge = {
  pizza: { articles: 22, file_minutes: 42, compte: true },
  cuisine: { articles: 3, file_minutes: 5, compte: true },
  preparation_minutes: 20,
  plafond_minutes: 45,
  allongement_minutes: 25,
  allongement_livraison_minutes: 25,
};

describe("lireCharge", () => {
  it("lit la réponse de la base", () => {
    expect(lireCharge(CHARGE)).toEqual(CHARGE);
  });
  it("illisible ou absente : null (pas d'allongement)", () => {
    expect(lireCharge(null)).toBeNull();
    expect(lireCharge({ ...CHARGE, allongement_minutes: -5 })).toBeNull();
    expect(lireCharge({ ...CHARGE, pizza: { articles: "22" } })).toBeNull();
  });
  it("le plafond fait foi", () => {
    expect(lireCharge({ ...CHARGE, allongement_minutes: 90 })?.allongement_minutes).toBe(45);
  });
});

describe("lireCharge, attente d'un livreur (version 2)", () => {
  const LIVRAISON = { livraisons: 4, livreurs: 1, attente_minutes: 60, compte: true, allongement_minutes: 40 };
  it("livraison : le plus long de la cuisine et de l'attente d'un livreur", () => {
    const c = lireCharge(CHARGE, LIVRAISON);
    expect(c?.livraison).toEqual({ livraisons: 4, livreurs: 1, attente_minutes: 60, compte: true });
    expect(c?.allongement_minutes).toBe(25);
    expect(c?.allongement_livraison_minutes).toBe(40);
    // Cuisine plus chargée que la livraison : la livraison suit la cuisine.
    expect(lireCharge({ ...CHARGE, allongement_minutes: 45 }, LIVRAISON)?.allongement_livraison_minutes).toBe(45);
  });
  it("pas comptée, absente ou illisible : la livraison suit la cuisine", () => {
    expect(lireCharge(CHARGE, { ...LIVRAISON, compte: false })?.allongement_livraison_minutes).toBe(25);
    expect(lireCharge(CHARGE)?.allongement_livraison_minutes).toBe(25);
    expect(lireCharge(CHARGE)?.livraison).toBeUndefined();
    expect(lireCharge(CHARGE, { ...LIVRAISON, livreurs: -1 })?.livraison).toBeUndefined();
  });
  it("plafond de la cuisine aussi pour la livraison", () => {
    expect(lireCharge(CHARGE, { ...LIVRAISON, allongement_minutes: 90 })?.allongement_livraison_minutes).toBe(45);
  });
});

describe("raisonCharge", () => {
  it("dit le poste chargé et l'allongement", () => {
    expect(raisonCharge(CHARGE)).toBe("Four : 22 pizzas en file, 42 min. Heures annoncées +25 min.");
  });
  it("signale le plafond atteint", () => {
    expect(raisonCharge({ ...CHARGE, allongement_minutes: 45 })).toBe("Four : 22 pizzas en file, 42 min. Heures annoncées +45 min (au plus).");
  });
  it("livreurs en retard : livraisons et retraits séparés", () => {
    const livraison = { livraisons: 4, livreurs: 1, attente_minutes: 60, compte: true };
    expect(raisonCharge({ ...CHARGE, livraison, allongement_livraison_minutes: 40 })).toBe(
      "Four : 22 pizzas en file, 42 min. Livraison : 1 livreur pour 4 livraisons, 60 min. Livraisons +40 min, retraits +25 min.",
    );
    const calme = { ...CHARGE, pizza: { ...CHARGE.pizza, file_minutes: 10 }, allongement_minutes: 0 };
    expect(raisonCharge({ ...calme, livraison, allongement_livraison_minutes: 40 })).toBe(
      "Livraison : 1 livreur pour 4 livraisons, 60 min. Livraisons +40 min, retraits à l'heure habituelle.",
    );
  });
  it("rien quand la file n'allonge rien", () => {
    expect(raisonCharge({ ...CHARGE, allongement_minutes: 0, allongement_livraison_minutes: 0 })).toBeNull();
    expect(raisonCharge(null)).toBeNull();
  });
});

describe("fourchette", () => {
  const config = { reglages: { preparation_minutes: 20, creneau_minutes: 15, avance_jours: 6, fourchette: { livraison: 15, retrait: 10 } } };
  it("autour de l'heure promise, arrondie aux 5 minutes", () => {
    // 19h45 en livraison : de 19h40 à 19h55.
    expect(fourchette(config, "livraison", 19 * 60 + 45)).toEqual({ basse: 19 * 60 + 40, haute: 19 * 60 + 55 });
    expect(fourchette(config, "retrait", 19 * 60 + 30)).toEqual({ basse: 19 * 60 + 25, haute: 19 * 60 + 35 });
  });
  it("largeur 0 : une seule heure", () => {
    expect(fourchette({ reglages: { ...config.reglages, fourchette: { livraison: 0, retrait: 0 } } }, "retrait", 1170)).toEqual({ basse: 1170, haute: 1170 });
  });
  it("lit les réglages, valeurs proposées par défaut", () => {
    expect(lireFourchette([])).toEqual({ livraison: 15, retrait: 10 });
    expect(lireFourchette([{ cle: "fourchette_retrait_minutes", valeur: 20 }])).toEqual({ livraison: 15, retrait: 20 });
    expect(lireFourchette([{ cle: "fourchette_retrait_minutes", valeur: 500 }])).toEqual({ livraison: 15, retrait: 10 });
  });
});

describe("allongement dans l'heure annoncée", () => {
  // Vendredi 20 novembre 2026, 19h00 à Genève. Service du soir de 18h30 à 22h.
  const maintenant = new Date("2026-11-20T18:00:00Z");
  const base: ConfigService = {
    zones: [],
    npa: [],
    horaires: [{ jour: 5, service: "soir", premiere_heure: "18:30", derniere_heure: "22:00", derniere_commande: "21:30", derniere_commande_pizzas: "21:45" }],
    fermetures: [],
    reglages: { preparation_minutes: 20, creneau_minutes: 15, avance_jours: 6 },
  };
  it("dès que possible : l'allongement s'ajoute, jamais plus tôt qu'avant", () => {
    const sans = etatService(base, maintenant, "retrait");
    // config-service.ts ajoute l'allongement à preparation_minutes, comme le retard du soir.
    const avec = etatService({ ...base, reglages: { ...base.reglages, preparation_minutes: 45, allongement_minutes: 25 } }, maintenant, "retrait");
    expect(sans).toEqual({ etat: "ouvert", desQuePossible: 19 * 60 + 20 });
    expect(avec).toEqual({ etat: "ouvert", desQuePossible: 19 * 60 + 45 });
  });
  it("l'allongement ne décale pas l'ouverture avant le service", () => {
    // 18h15 à Genève : avec 20 min de préparation, « dès que possible » ouvre à 18h10. L'allongement ne
    // l'avance pas (il est retiré de la fenêtre d'avant service, comme le retard du soir).
    const tot = new Date("2026-11-20T17:05:00Z");
    const avec = etatService({ ...base, reglages: { ...base.reglages, preparation_minutes: 45, allongement_minutes: 25 } }, tot, "retrait");
    expect(avec.etat).toBe("ferme");
  });
  it("livraison : l'attente d'un livreur allonge la zone, pas l'ouverture avant le service", () => {
    const zone = { numero: 1, nom: "Zone 1", frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 40, active: true, proposition: false };
    // config-service.ts ajoute 40 min aux délais de zone (attente d'un livreur), rien au retrait.
    const config = { ...base, zones: [{ ...zone, delai_min: 70, delai_max: 80 }], reglages: { ...base.reglages, allongement_minutes: 0, allongement_livraison_minutes: 40 } };
    expect(etatService(config, maintenant, "livraison", config.zones[0])).toEqual({ etat: "ouvert", desQuePossible: 19 * 60 + 75 });
    expect(etatService(config, maintenant, "retrait")).toEqual({ etat: "ouvert", desQuePossible: 19 * 60 + 20 });
    // 18h05 : sans allongement la livraison ouvre à 18h00 (18h30 moins 30 min). L'allongement ne l'avance pas.
    const tot = new Date("2026-11-20T17:05:00Z");
    expect(etatService(config, tot, "livraison", config.zones[0]).etat).toBe("ouvert");
    expect(etatService(config, new Date("2026-11-20T16:55:00Z"), "livraison", config.zones[0]).etat).toBe("ferme");
  });
});
