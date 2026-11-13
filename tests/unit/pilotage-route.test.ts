import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analyses, TableauVentes } from "@/lib/pilotage";

// Route du tableau des ventes : le gérant passe, les autres non, la période est contrôlée, la base répond
// avec ou sans bornes de comparaison (null transmis tel quel à pilotage_ventes).
const acces = { gerant: true };
vi.mock("@/lib/personnel/session", () => ({
  exigerGerant: async () =>
    acces.gerant
      ? { personnel: { id: "00000000-0000-0000-0000-000000000000", role: "gerant", nom: "Test" } }
      : { reponse: NextResponse.json({ erreur: "Réservé au gérant." }, { status: 403 }) },
}));

const { GET } = await import("@/app/api/gestion/pilotage/ventes/route");
const analysesRoute = await import("@/app/api/gestion/pilotage/analyses/route");
const tempsRoute = await import("@/app/api/gestion/pilotage/temps/route");
const exportRoute = await import("@/app/api/gestion/export/route");
const remboursementsRoute = await import("@/app/api/gestion/pilotage/remboursements/route");
const appel = (q: string) => GET(new Request(`http://localhost:3000/api/gestion/pilotage/ventes?${q}`));

beforeEach(() => {
  acces.gerant = true;
});

describe("GET /api/gestion/pilotage/ventes", () => {
  it("réservée au gérant", async () => {
    acces.gerant = false;
    expect((await appel("periode=jour&jour=2026-12-04")).status).toBe(403);
  });

  it("refuse une période invalide", async () => {
    expect((await appel("periode=choisie&debut=2026-12-10&fin=2026-12-01")).status).toBe(422);
  });

  it("rend le tableau d'un jour (comparaison par défaut) et d'un mois (mois précédent)", async () => {
    const jour = await appel("periode=jour&jour=2026-12-04");
    expect(jour.status).toBe(200);
    expect(jour.headers.get("cache-control")).toBe("no-store");
    const t = (await jour.json()) as TableauVentes;
    expect(t.comparaison).toMatchObject({ debut: "2026-11-27", fin: "2026-11-27" });
    expect(t.jours).toHaveLength(1);

    const mois = (await (await appel("periode=mois&jour=2026-12-15")).json()) as TableauVentes;
    expect(mois.periode).toMatchObject({ debut: "2026-12-01", fin: "2026-12-31" });
    expect(mois.comparaison).toMatchObject({ debut: "2026-11-01", fin: "2026-11-30" });
    expect(mois.jours).toHaveLength(31);

    const soir = (await (await appel("periode=jour&jour=2026-12-04&service=soir")).json()) as TableauVentes;
    expect(soir.service).toBe("soir");
    expect((await appel("periode=jour&service=nuit")).status).toBe(422);
  });

  it("analyses : même contrôle d'accès et de période, un seul service possible", async () => {
    const lire = (q: string) => analysesRoute.GET(new Request(`http://localhost:3000/api/gestion/pilotage/analyses?${q}`));
    const a = (await (await lire("periode=semaine&jour=2026-12-04&service=midi")).json()) as Analyses;
    expect(a).toMatchObject({ debut: "2026-11-30", fin: "2026-12-06", service: "midi", plats: [], clients: { clients: 0 } });
    expect((await lire("periode=choisie&debut=2026-12-10&fin=2026-12-01")).status).toBe(422);
    acces.gerant = false;
    expect((await lire("periode=jour")).status).toBe(403);
  });

  it("export par jour et par taux en fichier, remboursements à suivre en JSON, gérant seulement", async () => {
    const csv = await exportRoute.GET(new Request("http://localhost:3000/api/gestion/export?debut=2026-12-01&fin=2026-12-31&format=jours"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toContain("la-ferme-jours-2026-12-01-2026-12-31.csv");
    expect(new Uint8Array(await csv.clone().arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(await csv.text()).toMatch(/^\uFEFF?Jour;Taux TVA %/);
    const liste = await remboursementsRoute.GET(new Request("http://localhost:3000/api/gestion/pilotage/remboursements"));
    expect(Array.isArray(await liste.json())).toBe(true);
    acces.gerant = false;
    expect((await remboursementsRoute.GET(new Request("http://localhost:3000/api/gestion/pilotage/remboursements"))).status).toBe(403);
  });

  it("temps : même contrôle d'accès et de période", async () => {
    const lire = (q: string) => tempsRoute.GET(new Request(`http://localhost:3000/api/gestion/pilotage/temps?${q}`));
    expect(await (await lire("periode=semaine&jour=2026-12-04&service=soir")).json()).toMatchObject({ debut: "2026-11-30", service: "soir", postes: [] });
    expect((await lire("periode=choisie&debut=2026-12-10&fin=2026-12-01")).status).toBe(422);
    acces.gerant = false;
    expect((await lire("periode=jour")).status).toBe(403);
  });
});
