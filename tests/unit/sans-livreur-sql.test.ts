import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Aucun livreur prévu (vague 3, bo-operations) : livreurs_prevus, services_sans_livreur et l'interrupteur de la
// règle. Migration 20261130240000_sans_livreur.sql.

let db: PGlite;
const ids: Record<string, string> = {};
const prevus = async (jour: string, service: string) => (await db.query<{ n: number }>("select livreurs_prevus($1, $2) as n", [jour, service])).rows[0].n;

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec("update personnel set actif = false where role = 'livreur'");
  for (const cle of ["marco", "ines"]) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, 'livreur') returning id", [`sl-${cle}@laferme.test`, `Sl ${cle}`]);
    ids[cle] = r.rows[0].id;
  }
}, 120_000);

beforeEach(async () => {
  await db.exec("delete from livreurs_semaine where true; delete from livreurs_jours where true;");
});

describe("livreurs_prevus et services_sans_livreur", () => {
  it("semaine type, absence et renfort du jour", async () => {
    // Vendredi 20 novembre 2026 (isodow 5).
    await db.query("insert into livreurs_semaine (livreur_id, jour, service) values ($1, 5, 'soir')", [ids.marco]);
    expect(await prevus("2026-11-20", "soir")).toBe(1);
    expect(await prevus("2026-11-20", "midi")).toBe(0);
    await db.query("insert into livreurs_jours (livreur_id, jour, service, present, motif) values ($1, '2026-11-20', 'soir', false, 'Malade')", [ids.marco]);
    expect(await prevus("2026-11-20", "soir")).toBe(0);
    await db.query("insert into livreurs_jours (livreur_id, jour, service, present) values ($1, '2026-11-20', 'soir', true)", [ids.ines]);
    expect(await prevus("2026-11-20", "soir")).toBe(1);
  });

  it("liste des services sans personne, 15 jours au plus", async () => {
    await db.query("insert into livreurs_semaine (livreur_id, jour, service) values ($1, 5, 'soir')", [ids.marco]);
    const r = (await db.query<{ r: { jour: string; service: string }[] }>("select services_sans_livreur('2026-11-20', '2026-11-21') as r")).rows[0].r;
    expect(r).toEqual([
      { jour: "2026-11-20", service: "midi" },
      { jour: "2026-11-21", service: "midi" },
      { jour: "2026-11-21", service: "soir" },
    ]);
    const long = (await db.query<{ r: unknown[] }>("select services_sans_livreur('2026-11-20', '2026-12-31') as r")).rows[0].r;
    // 15 jours (du 20 novembre au 4 décembre) de deux services, moins les trois vendredis soir de Marco.
    expect(long).toHaveLength(27);
  });

  it("règle proposée et décochée, déclarée parmi les interrupteurs (cache de la config)", async () => {
    const r = await db.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = 'livraison_sans_livreur_fermee'");
    expect(r.rows[0]).toEqual({ valeur: false, proposition: true });
    const i = await db.query<{ cache: string }>("select cache from interrupteurs_gestion where cle = 'livraison_sans_livreur_fermee'");
    expect(i.rows[0].cache).toBe("config-service");
  });

  it("réservées au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ a: boolean; b: boolean }>(
        "select has_function_privilege($1, 'livreurs_prevus(date, text)', 'execute') as a, has_function_privilege($1, 'services_sans_livreur(date, date)', 'execute') as b",
        [role],
      );
      expect(r.rows[0]).toEqual({ a: false, b: false });
    }
  });
});
