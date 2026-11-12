import { afterEach, describe, expect, it, vi } from "vitest";
import { memeNumero, memeRue, numeroTape, trierSuggestions, type Adresse } from "@/lib/adresse";
import { retrouverAdresse } from "@/lib/adresse-serveur";

// Correctifs du rapport client mystère (CM-01, CM-07).

describe("comparaison de rues tolérante (CM-01)", () => {
  it("accepte les abréviations, la casse, les accents et les tirets", () => {
    expect(memeRue("Av. du Gros-Chêne", "Avenue du Gros-Chêne")).toBe(true);
    expect(memeRue("av du gros chene", "Avenue du Gros-Chêne")).toBe(true);
    expect(memeRue("Ch. de la Caroline", "Chemin de la Caroline")).toBe(true);
    expect(memeRue("Rte de Chancy", "Route de Chancy")).toBe(true);
    expect(memeRue("Bd Carl-Vogt", "Boulevard Carl-Vogt")).toBe(true);
    expect(memeRue("Pl. du Marché", "Place du Marché")).toBe(true);
    expect(memeRue("Rue St-Joseph", "Rue Saint-Joseph")).toBe(true);
    expect(memeRue("AVENUE GROS-CHENE", "Avenue du Gros-Chêne")).toBe(true);
  });
  it("refuse une autre rue", () => {
    expect(memeRue("Rue de la Servette", "Avenue du Gros-Chêne")).toBe(false);
    expect(memeRue("Avenue du Gros", "Avenue du Gros-Chêne")).toBe(false);
    expect(memeRue("Route de Chancy", "Chemin de Chancy")).toBe(false);
    expect(memeRue("", "Avenue du Gros-Chêne")).toBe(false);
  });
  it("compare les numéros sans tenir compte des espaces ni de la casse", () => {
    expect(memeNumero("20 A", "20a")).toBe(true);
    expect(memeNumero("20", "20a")).toBe(false);
    expect(memeNumero("20", "2")).toBe(false);
  });
});

describe("retrouverAdresse (CM-01)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reponse = (labels: [string, string][]) =>
    vi.fn(async () => new Response(JSON.stringify({ results: labels.map(([label, featureId]) => ({ attrs: { label, featureId } })) })));

  it("retrouve une adresse abrégée", async () => {
    vi.stubGlobal("fetch", reponse([["Avenue du Gros-Chêne 20 <b>1213 Onex</b>", "1022068_0"]]));
    await expect(retrouverAdresse({ rue: "Av. du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" })).resolves.toBe("1022068_0");
  });
  it("refuse toujours un NPA qui n'est pas celui du registre", async () => {
    // Le client annonce 1213 (zone 1) pour une rue de 1202 : le registre ne la trouve pas en 1213.
    vi.stubGlobal("fetch", reponse([["Rue de la Servette 50 <b>1202 Genève</b>", "1"]]));
    await expect(retrouverAdresse({ rue: "Rue de la Servette", numero: "50", npa: "1213", localite: "Onex" })).resolves.toBeNull();
  });
  it("refuse un autre numéro de la même rue", async () => {
    vi.stubGlobal("fetch", reponse([["Avenue du Gros-Chêne 22 <b>1213 Onex</b>", "2"]]));
    await expect(retrouverAdresse({ rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" })).resolves.toBeNull();
  });
});

describe("suggestions d'adresse (CM-07)", () => {
  const a = (rue: string, numero: string): Adresse => ({ rue, numero, npa: "1213", localite: "Onex" });
  it("lit le numéro tapé, pas le NPA", () => {
    expect(numeroTape("Rue de Rive 10 Nyon")).toBe("10");
    expect(numeroTape("Route de Chancy 30 1213")).toBe("30");
    expect(numeroTape("Route de Chancy 30a")).toBe("30a");
    expect(numeroTape("Route de Chancy")).toBeNull();
    expect(numeroTape("Rue du 31-Décembre 4")).toBe("4");
  });
  it("met le numéro tapé en tête, puis ses variantes", () => {
    const liste = [a("Rue de Rive", "22d"), a("Rue de Rive", "1"), a("Rue de Rive", "10a"), a("Rue de Rive", "10")];
    expect(trierSuggestions(liste, "Rue de Rive 10").map((x) => x.numero)).toEqual(["10", "10a", "22d", "1"]);
  });
  it("ne change rien sans numéro tapé", () => {
    const liste = [a("Rue de Rive", "22d"), a("Rue de Rive", "1")];
    expect(trierSuggestions(liste, "Rue de Rive")).toEqual(liste);
  });
});

describe("numéro tapé dans un nom de rue (revue)", () => {
  it("prend le dernier nombre isolé", () => {
    expect(numeroTape("Chemin des 3 Communes 5")).toBe("5");
  });
});
