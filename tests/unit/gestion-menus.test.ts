import { describe, expect, it } from "vitest";
import { champsMenu, etapesMenu } from "@/lib/gestion-menus";

// Saisie des menus au back-office. Montants d'essai seulement.

describe("menu", () => {
  it("neuf : nom et prix exigés, naît inactif", () => {
    expect(champsMenu({ nom: " Formule  midi ", prix: "24.50", prix_valide: true, actif: true }, true)).toEqual({
      ok: true,
      valeur: { nom: "Formule midi", prix_centimes: 2450, prix_valide: true },
    });
    expect(champsMenu({ nom: "Formule" }, true)).toMatchObject({ ok: false });
    expect(champsMenu({ nom: "Formule", prix: "0" }, true)).toMatchObject({ ok: false });
    expect(champsMenu({ prix: "12" }, true)).toMatchObject({ ok: false });
  });

  it("modifié : seulement les champs donnés, activation comprise", () => {
    expect(champsMenu({ actif: true }, false)).toEqual({ ok: true, valeur: { actif: true } });
    expect(champsMenu({ actif: "oui" }, false)).toMatchObject({ ok: false });
    expect(champsMenu({ description: "x".repeat(401) }, false)).toMatchObject({ ok: false });
  });
});

describe("étapes", () => {
  it("catégorie ou plats, minimum et maximum, suppléments en francs", () => {
    expect(etapesMenu([{ nom: "Une pizza", categorie: "pizzas", plats: [{ slug: "pizza-tonno", supplement: "3" }] }, { nom: "Un dessert", plats: [{ slug: "tiramisu" }] }])).toEqual({
      ok: true,
      valeur: [
        { nom: "Une pizza", choix_min: 1, choix_max: 1, categorie: "pizzas", plats: [{ slug: "pizza-tonno", supplement_centimes: 300 }] },
        { nom: "Un dessert", choix_min: 1, choix_max: 1, categorie: null, plats: [{ slug: "tiramisu", supplement_centimes: 0 }] },
      ],
    });
    expect(etapesMenu([{ nom: "Vide" }])).toMatchObject({ ok: false });
    expect(etapesMenu([{ nom: "A", categorie: "pizzas", choix_min: 2, choix_max: 1 }])).toMatchObject({ ok: false });
    expect(etapesMenu(Array.from({ length: 7 }, (_, i) => ({ nom: `E${i}`, categorie: "pizzas" })))).toMatchObject({ ok: false });
    expect(etapesMenu([{ nom: "A", plats: [{ slug: "pizza-tonno", supplement: "abc" }] }])).toMatchObject({ ok: false });
    expect(etapesMenu("non")).toMatchObject({ ok: false });
  });
});
