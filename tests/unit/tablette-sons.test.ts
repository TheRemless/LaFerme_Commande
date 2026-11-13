import { describe, expect, it } from "vitest";
import { acceptablesEnSerie, nouveaux } from "@/components/tablette/sons";

// Sons distincts et acceptation en série (vague 3).

describe("nouveaux", () => {
  it("rien au chargement, puis seulement ce qui apparaît, une fois", () => {
    const vus = { current: null as Set<string> | null };
    expect(nouveaux(vus, ["a", "b"])).toEqual([]);
    expect(nouveaux(vus, ["a", "b", "c"])).toEqual(["c"]);
    expect(nouveaux(vus, ["a", "b", "c"])).toEqual([]);
    // Une imprimante qui change d'état (hors ligne, puis plus de papier) est une nouvelle clé.
    expect(nouveaux(vus, ["imprimante:1:plus de papier"])).toEqual(["imprimante:1:plus de papier"]);
  });
});

describe("acceptablesEnSerie", () => {
  it("une allergie ou un avertissement se lit d'abord", () => {
    const c = (id: string, allergie = "", avertissement: string | null = null) => ({ id, allergie, avertissement });
    const { serie, aLire } = acceptablesEnSerie([c("1"), c("2", "arachides"), c("3", "", "Adresse hors zone"), c("4", "  ")]);
    expect(serie.map((x) => x.id)).toEqual(["1", "4"]);
    expect(aLire.map((x) => x.id)).toEqual(["2", "3"]);
  });
});
