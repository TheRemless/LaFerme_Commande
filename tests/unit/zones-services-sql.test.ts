import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Zones par service et zone fermée jusqu'à une heure, côté base : migration 20261130110000_zones_services.sql.

let db: PGlite;
const ids: Record<string, string> = {};

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const zone = async (n: number) =>
  (await db.query<{ services: string[]; fermee_jusqu_a: Date | null; fermee_motif: string | null }>("select services, fermee_jusqu_a, fermee_motif from zones_livraison where numero = $1", [n])).rows[0];
const journal = async () =>
  (await db.query<{ objet: string; cle: string; personnel_nom: string; avant: unknown; apres: unknown }>("select objet, cle, personnel_nom, avant, apres from journal_gestion order by id desc limit 1")).rows[0];

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  for (const [cle, role] of [["service", "service"], ["gerant", "gerant"], ["livreur", "livreur"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`zs-${cle}@laferme.test`, `Zs ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
});

beforeEach(async () => {
  await horloge("2026-11-20T18:00:00Z");
  await db.query("update zones_livraison set services = '{midi,soir}', fermee_jusqu_a = null, fermee_motif = null where numero between 1 and 3");
});

describe("services d'une zone", () => {
  it("le gérant règle les services, dans l'ordre midi puis soir, journalisé", async () => {
    expect(await f<boolean>("regler_zone_services(3::smallint, $1, $2)", [["soir", "midi", "soir"], ids.gerant])).toBe(true);
    expect((await zone(3)).services).toEqual(["midi", "soir"]);
    expect(await f<boolean>("regler_zone_services(3::smallint, $1, $2)", [["soir"], ids.gerant])).toBe(true);
    expect((await zone(3)).services).toEqual(["soir"]);
    expect(await journal()).toMatchObject({ objet: "zone_services", cle: "3", personnel_nom: "Zs gerant", avant: ["midi", "soir"], apres: ["soir"] });
  });

  it("refuse un service inconnu, une liste vide et un membre qui n'est pas gérant", async () => {
    await expect(f("regler_zone_services(3::smallint, $1, $2)", [["nuit"], ids.gerant])).rejects.toThrow(/Services/);
    await expect(f("regler_zone_services(3::smallint, $1, $2)", [[], ids.gerant])).rejects.toThrow(/Services/);
    await expect(f("regler_zone_services(3::smallint, $1, $2)", [["soir"], ids.service])).rejects.toThrow(/gérant/);
    expect(await f<boolean>("regler_zone_services(9::smallint, $1, $2)", [["soir"], ids.gerant])).toBe(false);
  });

  it("la table elle-même refuse une valeur hors liste", async () => {
    await expect(db.query("update zones_livraison set services = '{}' where numero = 3")).rejects.toThrow();
    await expect(db.query("update zones_livraison set services = '{nuit}' where numero = 3")).rejects.toThrow();
  });
});

describe("zone fermée jusqu'à une heure", () => {
  it("l'équipe ferme une zone avec un motif, puis la rouvre", async () => {
    expect(await f<boolean>("fermer_zone(2::smallint, '2026-11-20T20:00:00Z', ' Neige ', $1)", [ids.service])).toBe(true);
    const z = await zone(2);
    expect(new Date(z.fermee_jusqu_a!).toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(z.fermee_motif).toBe("Neige");
    expect(await journal()).toMatchObject({ objet: "zone_fermeture", cle: "2", personnel_nom: "Zs service", apres: { motif: "Neige" } });
    expect(await f<boolean>("rouvrir_zone(2::smallint, $1)", [ids.gerant])).toBe(true);
    expect((await zone(2)).fermee_jusqu_a).toBeNull();
    expect((await journal()).apres).toBeNull();
    // Déjà rouverte : rien à faire.
    expect(await f<boolean>("rouvrir_zone(2::smallint, $1)", [ids.gerant])).toBe(false);
  });

  it("une fermeture finie ne se « rouvre » pas", async () => {
    await f("fermer_zone(2::smallint, '2026-11-20T18:30:00Z', 'Neige', $1)", [ids.service]);
    await horloge("2026-11-20T18:31:00Z");
    expect(await f<boolean>("rouvrir_zone(2::smallint, $1)", [ids.service])).toBe(false);
  });

  it("refuse une heure passée ou à plus de sept jours, un motif vide, un livreur", async () => {
    await expect(f("fermer_zone(2::smallint, '2026-11-20T17:00:00Z', 'Neige', $1)", [ids.service])).rejects.toThrow(/sept jours/);
    await expect(f("fermer_zone(2::smallint, '2026-11-28T18:00:00Z', 'Neige', $1)", [ids.service])).rejects.toThrow(/sept jours/);
    await expect(f("fermer_zone(2::smallint, '2026-11-20T20:00:00Z', ' ', $1)", [ids.service])).rejects.toThrow(/Motif/);
    await expect(f("fermer_zone(2::smallint, '2026-11-20T20:00:00Z', 'Neige', $1)", [ids.livreur])).rejects.toThrow(/équipe/);
    await expect(f("rouvrir_zone(2::smallint, $1)", [ids.livreur])).rejects.toThrow(/équipe/);
    expect((await zone(2)).fermee_jusqu_a).toBeNull();
  });

  it("les fonctions ne sont pas ouvertes aux visiteurs", async () => {
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p where p.proname in ('regler_zone_services', 'fermer_zone', 'rouvrir_zone')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });
});
