import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Responsable de service (D1, bo-socle) : il voit l'équipe et déconnecte un appareil perdu, jamais celui d'un
// gérant ; l'équipe de service ne peut rien ; tout se ferme quand role_responsable_actif repasse à false.

let db: PGlite;
const id: Record<string, string> = {};
const session = async (pid: string, hache: string) =>
  (await db.query<{ id: string }>("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1::uuid, $2, now() + interval '1 day') returning id::text", [pid, hache])).rows[0].id;
const activer = (oui: boolean) =>
  db.query("insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', $1::jsonb, false) on conflict (cle) do update set valeur = excluded.valeur", [oui ? "true" : "false"]);

beforeAll(async () => {
  db = await creerBaseLocale();
  for (const [cle, role] of [["responsable", "responsable"], ["service", "service"], ["livreur", "livreur"], ["gerant", "gerant"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id::text as id", [`ra-${cle}@laferme.test`, `Ra ${cle}`, role]);
    id[cle] = r.rows[0].id;
  }
});

describe("appareils de l'équipe et responsable de service", () => {
  it("la base embarquée a le rôle activé, comme la production une fois le réglage posé", async () => {
    expect((await db.query<{ r: boolean }>("select role_responsable_actif() as r")).rows[0].r).toBe(true);
  });

  it("le responsable voit l'équipe et coupe le téléphone d'un livreur, journalisé à son nom", async () => {
    await activer(true);
    const liste = (await db.query<{ r: { id: string }[] }>("select liste_personnel($1::uuid) as r", [id.responsable])).rows[0].r;
    expect(liste.some((m) => m.id === id.livreur)).toBe(true);
    const s = await session(id.livreur, "ra-livreur-1");
    const appareils = (await db.query<{ r: { id: string }[] }>("select appareils_personnel($1::uuid, $2::uuid, '') as r", [id.livreur, id.responsable])).rows[0].r;
    expect(appareils.map((a) => a.id)).toEqual([s]);
    expect((await db.query<{ r: boolean }>("select couper_appareil_personnel($1::uuid, $2::uuid) as r", [s, id.responsable])).rows[0].r).toBe(true);
    const j = await db.query<{ personnel_nom: string }>("select personnel_nom from journal_gestion where cle = 'ra-livreur@laferme.test' order by id desc limit 1");
    expect(j.rows[0].personnel_nom).toBe("Ra responsable");
  });

  it("jamais l'appareil d'un gérant ; le gérant, lui, peut", async () => {
    await activer(true);
    const s = await session(id.gerant, "ra-gerant-1");
    await expect(db.query("select appareils_personnel($1::uuid, $2::uuid, '')", [id.gerant, id.responsable])).rejects.toThrow(/droit_refuse/);
    await expect(db.query("select couper_appareil_personnel($1::uuid, $2::uuid)", [s, id.responsable])).rejects.toThrow(/droit_refuse/);
    const gerant = (await db.query<{ id: string }>("select id::text as id from personnel where email = 'gerant-bureau@laferme.test'")).rows[0].id;
    expect((await db.query<{ r: boolean }>("select couper_appareil_personnel($1::uuid, $2::uuid) as r", [s, gerant])).rows[0].r).toBe(true);
  });

  it("l'équipe de service ne peut rien, le responsable non plus quand le rôle est coupé", async () => {
    await activer(true);
    const s = await session(id.livreur, "ra-livreur-2");
    await expect(db.query("select liste_personnel($1::uuid)", [id.service])).rejects.toThrow(/droit_refuse/);
    await expect(db.query("select couper_appareil_personnel($1::uuid, $2::uuid)", [s, id.service])).rejects.toThrow(/droit_refuse/);
    await activer(false);
    await expect(db.query("select liste_personnel($1::uuid)", [id.responsable])).rejects.toThrow(/droit_refuse/);
    await expect(db.query("select couper_appareil_personnel($1::uuid, $2::uuid)", [s, id.responsable])).rejects.toThrow(/droit_refuse/);
    await activer(true);
  });
});
