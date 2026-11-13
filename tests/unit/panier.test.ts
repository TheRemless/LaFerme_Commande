import { beforeAll, describe, expect, it } from "vitest";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { calculerPanier, memeLigne, prixChoix, type Catalogue, type LignePanier } from "@/lib/panier";
import { creneaux, etatService, quandPossible, type ConfigService } from "@/lib/service";

// Catalogue lu dans la base embarquée : les montants attendus se déduisent du catalogue, jamais écrits ici.
let cat: Catalogue;
let config: ConfigService;
beforeAll(async () => {
  [cat, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);
});

const ligne = (slug: string, autre: Partial<LignePanier> = {}): LignePanier => ({ slug, qte: 1, choix: {}, retraits: [], note: "", ...autre });
const pizza = () => Object.values(cat.plats).find((p) => p.station === "pizza" && p.groupes.length && p.retraits.length)!;
const pates = () => Object.values(cat.plats).find((p) => p.groupes.some((g) => cat.groupes[g].choix_min === 1))!;

describe("prix d'une ligne", () => {
  it("additionne le plat et les suppléments choisis", () => {
    const p = pizza();
    const g = cat.groupes[p.groupes[0]];
    const [a, b] = g.options.filter((o) => o.prix_centimes > 0);
    const t = calculerPanier(cat, [ligne(p.slug, { qte: 2, choix: { [g.slug]: [a.nom, b.nom] } })], null);
    expect(t.lignes[0].unitaire_centimes).toBe(p.prix_centimes + a.prix_centimes + b.prix_centimes);
    expect(t.sous_total_centimes).toBe(2 * (p.prix_centimes + a.prix_centimes + b.prix_centimes));
    expect(t.valide).toBe(true);
  });

  it("donne le prix payé de chaque option, gardé avec la commande (S2-13)", () => {
    const p = pizza();
    const g = cat.groupes[p.groupes[0]];
    const [a, b] = g.options.filter((o) => o.prix_centimes > 0);
    const l = ligne(p.slug, { qte: 2, choix: { [g.slug]: [a.nom, b.nom] } });
    const prix = prixChoix(cat, l);
    expect(prix).toEqual({ [g.slug]: { [a.nom]: a.prix_centimes, [b.nom]: b.prix_centimes } });
    expect(p.prix_centimes + prix[g.slug][a.nom] + prix[g.slug][b.nom]).toBe(calculerPanier(cat, [l], null).lignes[0].unitaire_centimes);
  });

  it("ne fait pas payer les retraits", () => {
    const p = pizza();
    const t = calculerPanier(cat, [ligne(p.slug, { retraits: [p.retraits[0].nom] })], null);
    expect(t.total_centimes).toBe(p.prix_centimes);
  });

  it("refuse plus de suppléments que le maximum du groupe", () => {
    const p = pizza();
    const g = cat.groupes[p.groupes[0]];
    const trop = g.options.slice(0, g.choix_max + 1).map((o) => o.nom);
    expect(calculerPanier(cat, [ligne(p.slug, { choix: { [g.slug]: trop } })], null).lignes[0].erreur).toBeTruthy();
  });

  it("exige le choix obligatoire des pâtes", () => {
    const p = pates();
    const t = calculerPanier(cat, [ligne(p.slug)], null);
    // Nom du groupe tel que le gérant l'écrit (« Sauce au choix ») : jamais « Choisissez vos sauce au choix ».
    expect(t.lignes[0].erreur).toBe("Choisissez dans « Pâtes ».");
    expect(t.valide).toBe(false);
  });

  it("refuse une option ou un retrait inventés", () => {
    const p = pizza();
    expect(calculerPanier(cat, [ligne(p.slug, { choix: { [p.groupes[0]]: ["Caviar"] } })], null).lignes[0].erreur).toBeTruthy();
    expect(calculerPanier(cat, [ligne(p.slug, { retraits: ["Or fin"] })], null).lignes[0].erreur).toBeTruthy();
    expect(calculerPanier(cat, [ligne("plat-imaginaire")], null).valide).toBe(false);
  });
});

describe("livraison, minimum et TVA", () => {
  it("ajoute les frais de zone et calcule le montant manquant", () => {
    const z = config.zones.find((x) => x.active)!;
    const p = pizza();
    const t = calculerPanier(cat, [ligne(p.slug)], z);
    expect(t.frais_centimes).toBe(z.frais_centimes);
    expect(t.total_centimes).toBe(p.prix_centimes + z.frais_centimes);
    expect(t.manque_minimum_centimes).toBe(Math.max(0, z.minimum_centimes - p.prix_centimes));
  });

  it("donne la TVA comprise au taux réglé en base", () => {
    const p = pizza();
    const t = calculerPanier(cat, [ligne(p.slug, { qte: 3 })], null);
    expect(t.tva_centimes).toBe(Math.round((t.total_centimes * cat.tauxTvaPourcent) / (100 + cat.tauxTvaPourcent)));
  });

  it("signale les prix encore à valider", () => {
    expect(calculerPanier(cat, [ligne(pizza().slug)], null).prix_a_valider).toBe(true);
  });
});

describe("dernière commande des pizzas", () => {
  const geneve = (iso: string) => new Date(`${iso}+01:00`);
  it("un panier 100 % pizzas se commande après la dernière commande de la carte", () => {
    const h = config.horaires.find((x) => x.jour === 2 && x.service === "soir")!;
    if (h.derniere_commande === h.derniere_commande_pizzas) return;
    const entre = `2026-11-10T${h.derniere_commande.slice(0, 2)}:${String(Number(h.derniere_commande.slice(3, 5)) + 5).padStart(2, "0")}:00`;
    expect(etatService(config, geneve(entre), "retrait", undefined, true).etat).toBe("ouvert");
    expect(etatService(config, geneve(entre), "retrait", undefined, false).etat).toBe("ferme");
    expect(quandPossible(config, geneve(entre), "retrait", undefined, false, { type: "asap" })).toBe(false);
    expect(quandPossible(config, geneve(entre), "retrait", undefined, true, { type: "asap" })).toBe(true);
    expect(calculerPanier(cat, [ligne(pizza().slug)], null).pizzas_seulement).toBe(true);
    expect(calculerPanier(cat, [ligne(pizza().slug), ligne(pates().slug)], null).pizzas_seulement).toBe(false);
  });

  it("refuse un créneau qui n'existe pas", () => {
    const c = creneaux(config, geneve("2026-11-10T12:00:00"), "retrait")[0];
    expect(quandPossible(config, geneve("2026-11-10T12:00:00"), "retrait", undefined, false, { type: "creneau", date: c.date, minutes: c.minutes })).toBe(true);
    expect(quandPossible(config, geneve("2026-11-10T12:00:00"), "retrait", undefined, false, { type: "creneau", date: c.date, minutes: c.minutes + 1 })).toBe(false);
  });
});

describe("fusion des lignes", () => {
  it("reconnaît deux lignes identiques malgré l'ordre des options", () => {
    const a = ligne("x", { choix: { g: ["b", "a"] }, retraits: ["r"] });
    const b = ligne("x", { choix: { g: ["a", "b"] }, retraits: ["r"] });
    expect(memeLigne(a, b)).toBe(true);
    expect(memeLigne(a, { ...b, note: "bien cuite" })).toBe(false);
  });
});

describe("slugs hostiles", () => {
  it("refusent proprement au lieu de planter", () => {
    for (const slug of ["__proto__", "toString", "constructor"]) {
      const t = calculerPanier(cat, [ligne(slug)], null);
      expect(t.valide).toBe(false);
      expect(t.lignes[0].erreur).toBeTruthy();
    }
  });
});
