import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableauVentes } from "@/lib/pilotage";

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
  });
});
