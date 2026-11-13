import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// equipe_nom admet le responsable de service (rôle D1 de bo-socle) : migration 20261130200000.

let db: PGlite;
const ids: Record<string, string> = {};
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.query("insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false) on conflict (cle) do update set valeur = 'true'");
  for (const [cle, role] of [["responsable", "responsable"], ["livreur", "livreur"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`er-${cle}@laferme.test`, `Er ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
});

describe("equipe_nom et le responsable de service", () => {
  it("le responsable lance et finit un coup de feu", async () => {
    expect(await f<string>("equipe_nom($1)", [ids.responsable])).toBe("Er responsable");
    const e = await f<{ jusqua: string }>("lancer_coup_de_feu($1::jsonb, $2)", [JSON.stringify({ retard_minutes: 5, duree_minutes: 30 }), ids.responsable]);
    expect(e.jusqua).toBeTruthy();
    expect(await f("finir_coup_de_feu($1)", [ids.responsable])).not.toBeNull();
  });

  it("le livreur reste refusé", async () => {
    await expect(f("equipe_nom($1)", [ids.livreur])).rejects.toThrow(/équipe du restaurant/);
  });
});
