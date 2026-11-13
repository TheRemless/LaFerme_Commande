import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lireRecherche, nomObjet } from "@/lib/journal";
import type { PageJournal } from "@/lib/journal";

// Filtres du journal côté serveur et route POST { action: "chercher" | "filtres" }.
const acces = { gerant: true };
vi.mock("@/lib/personnel/session", () => ({
  exigerGerant: async () =>
    acces.gerant
      ? { personnel: { id: "00000000-0000-0000-0000-000000000000", role: "gerant", nom: "Test" } }
      : { reponse: NextResponse.json({ erreur: "Réservé au gérant." }, { status: 403 }) },
}));
const { POST } = await import("@/app/api/gestion/journal/route");
const poster = (corps: unknown) =>
  POST(new Request("http://localhost:3000/api/gestion/journal", { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  acces.gerant = true;
});

describe("filtres du journal", () => {
  it("garde ce qui est rempli, coupe les textes trop longs, refuse le reste", () => {
    expect(lireRecherche({ auteur: " Giuseppe ", objet: "plat", recherche: "  ", debut: "2026-12-01", fin: "" })).toEqual({
      ok: true,
      valeur: { auteur: "Giuseppe", objet: "plat", debut: "2026-12-01" },
    });
    expect(lireRecherche({ recherche: "x".repeat(100) })).toMatchObject({ ok: true, valeur: { recherche: "x".repeat(60) } });
    expect(lireRecherche({ objet: "Plat; drop" })).toMatchObject({ ok: false });
    expect(lireRecherche({ debut: "demain" })).toMatchObject({ ok: false });
    expect(lireRecherche({ debut: "2026-12-05", fin: "2026-12-01" })).toMatchObject({ ok: false });
    expect(lireRecherche({ avant_id: -3 })).toMatchObject({ ok: false });
    expect(lireRecherche({ limite: 1000 })).toMatchObject({ ok: false });
  });

  it("nomme les objets dans les mots de l'équipe", () => {
    expect(nomObjet("coup_de_feu")).toBe("Coup de feu");
    expect(nomObjet("cloture")).toBe("Clôture du jour");
    expect(nomObjet("objet_inconnu")).toBe("objet inconnu");
  });
});

describe("POST /api/gestion/journal", () => {
  it("cherche et donne les listes de filtres, au gérant seulement", async () => {
    const r = await poster({ action: "chercher", limite: 5 });
    expect(r.status).toBe(200);
    const page = (await r.json()) as PageJournal;
    expect(Array.isArray(page.entrees)).toBe(true);
    expect((await (await poster({ action: "filtres" })).json())).toHaveProperty("auteurs");
    expect((await poster({ action: "chercher", debut: "hier" })).status).toBe(422);
    acces.gerant = false;
    expect((await poster({ action: "chercher" })).status).toBe(403);
  });
});
