import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { derniereOptionObligatoire, parGroupe, rupturePlanifiee, texteRupture, type OptionRupture } from "@/components/tablette/ruptures";

// Ruptures sur la tablette (vague 3, base de bo-carte #55) : four ou cuisine en panne, ruptures « jusqu'au »,
// dernière option d'un choix obligatoire.

const session = vi.hoisted(() => ({ personnel: { id: "", email: "", nom: "", role: "service" as const } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET, POST } = await import("@/app/api/tablette/pannes/route");
const poster = (corps: unknown) => POST(new Request("http://localhost/api/tablette/pannes", { method: "POST", body: JSON.stringify(corps) }));

describe("textes et garde-fous", () => {
  it("motif de la rupture : panne du poste, date plus lointaine, aujourd'hui", () => {
    expect(texteRupture({ rupture: true, rupture_groupee: "poste:pizza" }, "2026-11-13")).toBe("Four en panne");
    expect(texteRupture({ rupture: true, rupture_groupee: "poste:cuisine" }, "2026-11-13")).toBe("Cuisine en panne");
    expect(texteRupture({ rupture: true, rupture_jusqu_au: "2026-11-15" }, "2026-11-13")).toBe("Épuisé jusqu'au 15 nov.");
    expect(texteRupture({ rupture: true, rupture_jusqu_au: "2026-11-13" }, "2026-11-13")).toBe("Épuisé aujourd'hui");
    expect(texteRupture({ rupture: false }, "2026-11-13")).toBeNull();
    expect(rupturePlanifiee({ rupture: true, rupture_jusqu_au: "2026-11-15" }, "2026-11-13")).toBe(true);
    expect(rupturePlanifiee({ rupture: true, rupture_jusqu_au: "2026-11-13" }, "2026-11-13")).toBe(false);
  });

  it("dernière option disponible d'un choix obligatoire", () => {
    const o = (nom: string, rupture: boolean, obligatoire = true): OptionRupture => ({ groupe: "choix-pates", groupe_nom: "Pâtes", nom, rupture, obligatoire });
    const opts = [o("Penne", false), o("Spaghetti", true), o("Tagliatelle", true)];
    expect(derniereOptionObligatoire(opts, opts[0])).toBe(true);
    expect(derniereOptionObligatoire([o("Penne", false), o("Spaghetti", false)], o("Penne", false))).toBe(false);
    expect(derniereOptionObligatoire([o("Ananas", false, false)], o("Ananas", false, false))).toBe(false);
    expect(parGroupe([...opts, { groupe: "supplements", groupe_nom: "Suppléments", nom: "Ananas", rupture: false }]).map((g) => [g.nom, g.options.length, g.obligatoire])).toEqual([
      ["Pâtes", 3, true],
      ["Suppléments", 1, false],
    ]);
  });
});

describe("four en panne", () => {
  it("toutes les pizzas épuisées jusqu'à ce soir, puis le four remarche sans toucher aux ruptures plat par plat", async () => {
    const db = await baseLocale();
    session.personnel = { ...session.personnel, id: (await db.query<{ id: string }>("select id from personnel where role = 'service' and actif limit 1")).rows[0].id };
    const plats = async () => (await db.query<{ p: { slug: string; rupture: boolean; rupture_groupee: string | null; categorie: string }[] }>("select plats_tablette() as p")).rows[0].p;
    const pizza = (await plats()).find((p) => p.slug.startsWith("pizza-"))!;
    expect((await poster({ poste: "pizza", panne: true })).status).toBe(200);
    expect(((await (await GET(new Request("http://localhost/api/tablette/pannes"))).json()) as { cible: string }[]).map((r) => r.cible)).toContain("poste:pizza");
    const pendant = (await plats()).find((p) => p.slug === pizza.slug)!;
    expect(pendant).toMatchObject({ rupture: true, rupture_groupee: "poste:pizza" });
    expect((await poster({ poste: "pizza", panne: false })).status).toBe(200);
    expect((await plats()).find((p) => p.slug === pizza.slug)).toMatchObject({ rupture: pizza.rupture, rupture_groupee: null });
    expect((await poster({ poste: "bar", panne: true })).status).toBe(422);
  });
});
