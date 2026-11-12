import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// SS-10 (audit « samedi soir ») : seul un appareil qui a démarré le service donne le signe de vie de la
// tablette. Un téléphone qui regarde /tablette sans avoir touché « Démarrer le service » ne doit pas
// empêcher la pause automatique quand la tablette de la cuisine se tait.
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: { id: "00000000-0000-0000-0000-000000000000", email: "t@laferme.test", nom: "T", role: "service" } }),
}));

const { GET } = await import("@/app/api/tablette/file/route");

async function vueLe(): Promise<string | null> {
  const db = await baseLocale();
  return (await db.query<{ v: string | null }>("select tablette_vue_le::text as v from surveillance_etat")).rows[0].v;
}

describe("SS-10 : signe de vie de la tablette", () => {
  it("une simple lecture de la file n'écrit pas de signe de vie", async () => {
    const db = await baseLocale();
    await db.query("update surveillance_etat set tablette_vue_le = null where id");
    const r = await GET(new Request("http://localhost/api/tablette/file"));
    expect(r.status).toBe(200);
    expect(await vueLe()).toBeNull();
  });

  it("la tablette en service (« Démarrer le service » touché) l'écrit", async () => {
    const r = await GET(new Request("http://localhost/api/tablette/file?service=1"));
    expect(r.status).toBe(200);
    expect(await vueLe()).not.toBeNull();
  });
});
