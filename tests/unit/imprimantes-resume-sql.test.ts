import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Résumé des imprimantes au back-office : migration 20261130150000_imprimantes_resume.sql.
// Horloge simulée : vendredi 20 novembre 2026, 20h à Genève.

let db: PGlite;
let pizza: number;
let cuisine: number;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
    insert into horloge_test values ('2026-11-20T19:00:00Z');
    truncate commandes cascade;
  `);
  pizza = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache) values ('Pizza', 'pizza', 'h-rp') returning id")).rows[0].id;
  cuisine = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache) values ('Cuisine', 'cuisine', 'h-rc') returning id")).rows[0].id;
  const p = {
    jeton_suivi: "jeton-ri",
    cle_idempotence: "ri",
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: "Ri",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "ri@laferme.test",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query(
    `insert into taches_impression (commande_id, station, imprimante_id, contenu, etat, cree_le, imprime_le) values
      ($1, 'pizza', $2, '[]', 'imprimee', '2026-11-19T19:00:00Z', '2026-11-19T19:00:10Z'),
      ($1, 'pizza', $2, '[]', 'imprimee', '2026-11-20T18:30:00Z', '2026-11-20T18:30:12Z'),
      ($1, 'pizza', $2, '[]', 'en_attente', '2026-11-20T18:50:00Z', null),
      ($1, 'pizza', $2, '[]', 'echec', '2026-11-20T18:40:00Z', null),
      ($1, 'pizza', $2, '[]', 'echec', '2026-11-19T18:40:00Z', null)`,
    [c, pizza],
  );
});

describe("resume_imprimantes", () => {
  it("dernier ticket, en attente, imprimés et échecs du jour, par imprimante", async () => {
    const r = await f<Record<string, unknown>[]>("resume_imprimantes()");
    const p = r.find((x) => x.id === pizza)!;
    expect(new Date(p.dernier_ticket_le as string).toISOString()).toBe("2026-11-20T18:30:12.000Z");
    expect(p).toMatchObject({ en_attente: 1, imprimes_aujourdhui: 1, echecs_aujourdhui: 1 });
    expect(new Date(p.plus_ancien_en_attente_le as string).toISOString()).toBe("2026-11-20T18:50:00.000Z");
    expect(r.find((x) => x.id === cuisine)).toEqual({
      id: cuisine,
      dernier_ticket_le: null,
      en_attente: 0,
      plus_ancien_en_attente_le: null,
      imprimes_aujourdhui: 0,
      echecs_aujourdhui: 0,
    });
    expect(JSON.stringify(r)).not.toMatch(/Ri|ri@|079/);
  });

  it("fermée aux visiteurs", async () => {
    const r = await db.query<{ ok: boolean }>(
      "select has_function_privilege('anon', 'resume_imprimantes()', 'execute') or has_function_privilege('authenticated', 'resume_imprimantes()', 'execute') as ok",
    );
    expect(r.rows[0].ok).toBe(false);
  });
});
