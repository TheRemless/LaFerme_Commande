import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { commandesTouchees, derniereOptionObligatoire, parGroupe, rupturePlanifiee, texteRupture, type OptionRupture } from "@/components/tablette/ruptures";

// Ruptures sur la tablette (vague 3, base de bo-carte #55) : four ou cuisine en panne, ruptures « jusqu'au »,
// dernière option d'un choix obligatoire.

const session = vi.hoisted(() => ({ personnel: { id: "", email: "", nom: "", role: "service" as const } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET, POST } = await import("@/app/api/tablette/pannes/route");
const { GET: touchees } = await import("@/app/api/tablette/touchees/route");
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
    const pose = await poster({ cible: "poste:pizza", jusqu: "ce-soir" });
    expect(pose.status).toBe(200);
    const g = (await (await GET(new Request("http://localhost/api/tablette/pannes"))).json()) as { ruptures: { cible: string }[]; categories: { slug: string; nom: string }[] };
    expect(g.ruptures.map((r) => r.cible)).toContain("poste:pizza");
    expect(g.categories.length).toBeGreaterThan(1);
    expect(g.categories.some((c) => c.slug === "plat-du-jour")).toBe(false);
    const pendant = (await plats()).find((p) => p.slug === pizza.slug)!;
    expect(pendant).toMatchObject({ rupture: true, rupture_groupee: "poste:pizza" });
    expect((await poster({ cible: "poste:pizza", jusqu: null })).status).toBe(200);
    expect((await plats()).find((p) => p.slug === pizza.slug)).toMatchObject({ rupture: pizza.rupture, rupture_groupee: null });
    expect((await poster({ cible: "poste:bar", jusqu: "ce-soir" })).status).toBe(422);
    expect((await poster({ cible: "poste:pizza", jusqu: "toujours" })).status).toBe(422);
  });
});

describe("commandes touchées", () => {
  it("repli : commandes à préparer jusqu'à la date, seulement les lignes visées", () => {
    const c = (numero: number, statut: string, quand_date: string | null, lignes: [string, string][]) => ({
      id: String(numero), numero, statut, mode: "retrait" as const, quand_date, lignes: lignes.map(([nom, station]) => ({ nom, qte: 1, station })),
    });
    const file = [
      c(12, "acceptee", null, [["Pizza Margherita", "pizza"], ["Lasagne", "cuisine"]]),
      c(15, "nouvelle", null, [["Lasagne", "cuisine"]]),
      c(18, "prete", null, [["Pizza Margherita", "pizza"]]),
      c(20, "acceptee", "2026-11-20", [["Pizza Diavola", "pizza"]]),
    ];
    expect(commandesTouchees(file, { noms: new Set(["Pizza Margherita"]), station: null, jusqu: "2026-11-13" })).toEqual([
      { id: "12", numero: 12, jour: null, statut: "acceptee", mode: "retrait", lignes: [{ nom: "Pizza Margherita", qte: 1 }] },
    ]);
    expect(commandesTouchees(file, { noms: new Set(), station: "pizza", jusqu: "2026-11-21" }).map((x) => x.numero)).toEqual([12, 20]);
  });

  it("la route répond pour un plat ou une cible, et refuse le reste", async () => {
    const r = await touchees(new Request("http://localhost/api/tablette/touchees?slug=pizza-margherita"));
    expect(r.status).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
    expect((await touchees(new Request("http://localhost/api/tablette/touchees?cible=poste:pizza&jusqu_au=2026-11-14"))).status).toBe(200);
    expect((await touchees(new Request("http://localhost/api/tablette/touchees?cible=table:1"))).status).toBe(404);
    expect((await touchees(new Request("http://localhost/api/tablette/touchees"))).status).toBe(400);
  });
});
