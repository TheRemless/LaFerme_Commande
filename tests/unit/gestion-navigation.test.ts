import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPES_VISIBLES, RUBRIQUES, rubriqueDe, titreRubrique } from "@/components/gestion/navigation";

// Coque du back-office (vague 3) : le menu ne montre que des rubriques qui ont leur page, et une place
// réservée (aVenir) disparaît du code dès que la page arrive.
const page = (href: string) => path.join(process.cwd(), "src/app", href, "page.tsx");

describe("navigation du back-office", () => {
  it("chaque rubrique affichée a sa page, chaque place réservée n'en a pas encore", () => {
    for (const r of RUBRIQUES) expect(fs.existsSync(page(r.href)), `${r.href} ${r.aVenir ? "a sa page : retirer aVenir" : "n'a pas de page"}`).toBe(!r.aVenir);
  });

  it("les adresses sont uniques et sous /gestion", () => {
    const hrefs = RUBRIQUES.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h).toMatch(/^\/gestion(\/[a-z-]+)?$/);
  });

  it("le menu cache les places réservées et les groupes vides", () => {
    const visibles = GROUPES_VISIBLES.flatMap((g) => g.rubriques);
    expect(visibles.some((r) => r.aVenir)).toBe(false);
    expect(GROUPES_VISIBLES.every((g) => g.rubriques.length > 0)).toBe(true);
  });

  it("une adresse retrouve sa rubrique, une fiche reste dans sa rubrique, l'inconnu retombe sur l'accueil", () => {
    expect(rubriqueDe("/gestion/carte").rubrique.titre).toBe("Carte");
    expect(rubriqueDe("/gestion/commandes/37").rubrique.titre).toBe("Commandes");
    expect(rubriqueDe("/gestion/carte/").groupe.titre).toBe("Carte et offre");
    expect(rubriqueDe("/gestion/cartes").rubrique.titre).toBe("Accueil");
    expect(titreRubrique("/gestion/import")).toBe("Importer le tableau");
    expect(() => titreRubrique("/gestion/rien")).toThrow();
  });
});
