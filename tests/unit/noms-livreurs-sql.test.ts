import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// noms_livreurs : migration 20261130270000_noms_livreurs.sql.

let db: PGlite;

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`insert into personnel (email, nom, role, actif) values
    ('nl-nora-b@laferme.test', 'Nl Nora', 'livreur', true),
    ('nl-nora-k@laferme.test', 'Nl Nora', 'livreur', false),
    ('nl-service@laferme.test', 'Nl Service', 'service', true)`);
}, 120_000);

describe("noms_livreurs", () => {
  it("tous les livreurs, actifs ou non, avec leur e-mail ; pas l'équipe de service", async () => {
    const r = (await db.query<{ r: { nom: string; email: string }[] }>("select noms_livreurs() as r")).rows[0].r;
    const nl = r.filter((x) => x.nom.startsWith("Nl "));
    expect(nl.map((x) => x.email).sort()).toEqual(["nl-nora-b@laferme.test", "nl-nora-k@laferme.test"]);
  });
  it("réservée au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'noms_livreurs()', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
