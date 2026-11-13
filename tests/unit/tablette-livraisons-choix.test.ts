import { describe, expect, it } from "vitest";
import { choixLivreurs, tourneesAffichees } from "@/components/tablette/livraisons-choix";

// Livraisons (P1 du contrôle de produit-gestion) : peu de livreurs, un bouton chacun ; une grande équipe, les prévus
// au planning en boutons et les autres dans « Donner à… ».
const l = (id: string, actif = true) => ({ id, nom: id.toUpperCase(), actif });

describe("choix du livreur", () => {
  it("4 livreurs actifs au plus : tous en boutons, pas de menu", () => {
    expect(choixLivreurs([l("a"), l("b"), l("c", false)], { ids: ["a"] })).toEqual({ boutons: [l("a"), l("b")], menu: [] });
  });

  it("grande équipe : les prévus en boutons, les autres au menu ; sans planning, tout au menu", () => {
    const equipe = ["a", "b", "c", "d", "e", "f"].map((x) => l(x));
    const r = choixLivreurs(equipe, { ids: ["b", "e"] });
    expect(r.boutons.map((x) => x.id)).toEqual(["b", "e"]);
    expect(r.menu.map((x) => x.id)).toEqual(["a", "c", "d", "f"]);
    expect(choixLivreurs(equipe, { ids: [] })).toEqual({ boutons: [], menu: equipe });
  });

  it("grande équipe : un livreur dont la page est ouverte depuis moins de 6 heures a son bouton, même hors planning", () => {
    const maintenant = Date.parse("2026-11-13T19:00:00Z");
    const equipe = ["a", "b", "c", "d", "e"].map((x) => l(x));
    equipe[2] = { ...equipe[2], vu_le: "2026-11-13T18:58:00Z" } as typeof equipe[number];
    equipe[3] = { ...equipe[3], vu_le: "2026-11-12T19:00:00Z" } as typeof equipe[number];
    const r = choixLivreurs(equipe, { ids: ["a"] }, maintenant);
    expect(r.boutons.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("tournées : les prévus et ceux qui ont encore une livraison", () => {
    const equipe = ["a", "b", "c", "d", "e", "f"].map((x) => l(x));
    expect(tourneesAffichees(equipe, { ids: ["b"] }, new Set(["d"])).map((x) => x.id)).toEqual(["b", "d"]);
    expect(tourneesAffichees(equipe, null, new Set()).length).toBe(6);
  });
});
