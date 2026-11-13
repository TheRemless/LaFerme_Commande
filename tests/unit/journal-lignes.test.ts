import { describe, expect, it } from "vitest";
import { quoi, resume, sansChangement, type Entree } from "@/components/gestion/journal-lignes";

// Chaque ligne du journal dit de quoi elle parle, et une ligne sans changement ne s'affiche pas (contrôle final
// du chef de produit gestion, vague 3).
const e = (x: Partial<Entree>): Entree => ({ id: 1, personnel_nom: "Léa", objet: "plat", cle: "", avant: null, apres: null, le: "2026-11-13T18:00:00Z", ...x });

describe("lignes du journal", () => {
  it("un supplément porte son nom, avec ou sans groupe dans la clé", () => {
    expect(quoi(e({ objet: "option", cle: "supplements-pizza/Lardons" }))).toBe("Supplément Lardons");
    const sansGroupe = e({ objet: "option", cle: "Lardons", avant: { rupture: false }, apres: { rupture: true } });
    expect(quoi(sansGroupe)).toBe("Supplément Lardons");
    expect(resume(sansGroupe)).toBe("Rupture : non → oui");
  });

  it("un plat sans nom dans la ligne s'affiche sous son identifiant lisible", () => {
    expect(quoi(e({ objet: "plat", cle: "pizza-miss-italia", avant: { rupture: false }, apres: { rupture: true } }))).toBe("Plat pizza miss italia");
    expect(quoi(e({ objet: "plat", cle: "x", apres: { nom: "Margherita" } }))).toBe("Plat Margherita");
    expect(quoi(e({ objet: "rupture", cle: "pizza-miss-italia" }))).toBe("Rupture, pizza miss italia");
  });

  it("un réglage porte son nom, connu ou non, et sa valeur lisible", () => {
    const retard = e({ objet: "reglage", cle: "retard_minutes", avant: 0 as never, apres: 20 as never });
    expect(quoi(retard)).toBe("Réglage, retard ajouté aux heures");
    expect(resume(retard)).toBe("aucun retard → +20 min");
    expect(quoi(e({ objet: "reglage", cle: "nouveau_reglage_x" }))).toBe("Réglage, nouveau reglage x");
    expect(resume(e({ objet: "reglage", cle: "pause_auto", avant: false as never, apres: true as never }))).toBe("non → oui");
  });

  it("aucune ligne quand rien ne change", () => {
    expect(sansChangement(e({ objet: "reglage", cle: "retard_minutes", avant: 0 as never, apres: 0 as never }))).toBe(true);
    expect(sansChangement(e({ objet: "reglage", cle: "retard_minutes", avant: null, apres: 0 as never }))).toBe(false);
    expect(sansChangement(e({ objet: "plat", cle: "margherita", avant: { nom: "M", proposition: true }, apres: { nom: "M", proposition: false } }))).toBe(true);
    expect(sansChangement(e({ objet: "plat", cle: "margherita", avant: { rupture: false }, apres: { rupture: true } }))).toBe(false);
    expect(sansChangement(e({ objet: "plat_ajoute", cle: "x", apres: { nom: "X" } }))).toBe(false);
  });
  it("un compte du plan Crésus porte son rôle et ses deux numéros", () => {
    const l = e({ objet: "plan_comptes", cle: "ventes", avant: "3200" as never, apres: "3000" as never });
    expect(quoi(l)).toBe("Plan de comptes Crésus, Ventes");
    expect(resume(l)).toBe("Compte 3200 → 3000");
    expect(sansChangement(l)).toBe(false);
  });
});
