import { describe, expect, it } from "vitest";
import { normaliser, rechercher, texteRecherche } from "@/lib/recherche-gestion";

// Recherche globale du back-office (⌘K, vague 3) : le texte reçu, puis ce que rendent les listes existantes.
describe("recherche globale", () => {
  it("accepte deux lettres ou un numéro, coupe à 60 caractères", () => {
    expect(texteRecherche("a")).toBeNull();
    expect(texteRecherche("  ")).toBeNull();
    expect(texteRecherche(42)).toBeNull();
    expect(texteRecherche("7")).toBe("7");
    expect(texteRecherche("  Léa   Rossi ")).toBe("Léa Rossi");
    expect(texteRecherche("x".repeat(100))).toHaveLength(60);
  });

  it("compare sans accents ni majuscules", () => {
    expect(normaliser("Pâtes ÉTÉ")).toBe("pates ete");
  });

  it("trouve un plat, cinq résultats au plus par groupe, aucun client pour un numéro court", async () => {
    const r = await rechercher("tonno");
    expect(r.plats?.map((p) => p.nom)).toContain("Pizza Tonno");
    const pizzas = await rechercher("pizza");
    expect(pizzas.plats?.length).toBe(5);
    const numero = await rechercher("12");
    expect(numero.clients).toEqual([]);
    expect(Array.isArray(numero.commandes)).toBe(true);
  });
});
