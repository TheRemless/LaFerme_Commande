import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Messages d'information aux clients, côté base : migration 20261130160000_messages_clients.sql.

let db: PGlite;
const ids: Record<string, string> = {};
async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const ajouter = (p: Record<string, unknown>, qui = ids.gerant) => f<number>("ajouter_message_client($1::jsonb, $2)", [JSON.stringify(p), qui]);
const actifs = () => f<{ id: number; texte: string }[]>("messages_actifs()");

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  for (const [cle, role] of [["gerant", "gerant"], ["service", "service"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`mc-${cle}@laferme.test`, `Mc ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
});

beforeEach(async () => {
  await horloge("2026-11-20T10:00:00Z");
  await db.exec("delete from messages_clients where true");
});

describe("messages aux clients", () => {
  it("programmé, visible dans sa fenêtre, fini seul", async () => {
    const id = await ajouter({ texte: "  Fermé le 24   décembre au soir. ", debut: "2026-11-20T10:00:00Z", fin: "2026-11-21T10:00:00Z" });
    expect((await actifs()).map((m) => [m.id, m.texte])).toEqual([[id, "Fermé le 24 décembre au soir."]]);
    await horloge("2026-11-21T10:00:00Z");
    expect(await actifs()).toEqual([]);
  });

  it("un message qui commence dans plus de 24 heures n'est pas encore envoyé au site", async () => {
    await ajouter({ texte: "Nouveauté en décembre.", debut: "2026-11-22T10:00:00Z", fin: "2026-11-25T10:00:00Z" });
    expect(await actifs()).toEqual([]);
    await horloge("2026-11-21T10:30:00Z");
    expect((await actifs()).length).toBe(1);
  });

  it("retiré avant sa fin, journalisé, sans nom envoyé au site", async () => {
    const id = await ajouter({ texte: "Retard général ce soir.", fin: "2026-11-20T22:00:00Z", emplacement: "partout" });
    expect(JSON.stringify(await actifs())).not.toContain("Mc gerant");
    expect(await f<boolean>("retirer_message_client($1, $2)", [id, ids.gerant])).toBe(true);
    expect(await actifs()).toEqual([]);
    expect(await f<boolean>("retirer_message_client($1, $2)", [id, ids.gerant])).toBe(false);
    const j = await db.query<{ objet: string; cle: string; apres: unknown }>("select objet, cle, apres from journal_gestion where objet = 'message_client' order by id desc limit 1");
    expect(j.rows[0]).toEqual({ objet: "message_client", cle: String(id), apres: null });
  });

  it("bornes, cinq messages au plus, gérant seulement", async () => {
    await expect(ajouter({ texte: "Bof", fin: "2026-11-21T10:00:00Z" })).rejects.toThrow(/Texte/);
    await expect(ajouter({ texte: "x".repeat(201), fin: "2026-11-21T10:00:00Z" })).rejects.toThrow(/Texte/);
    await expect(ajouter({ texte: "Texte correct.", fin: "2026-11-20T09:00:00Z" })).rejects.toThrow(/Fin/);
    await expect(ajouter({ texte: "Texte correct.", fin: "2027-02-01T10:00:00Z" })).rejects.toThrow(/Fin/);
    await expect(ajouter({ texte: "Texte correct.", debut: "2026-11-19T10:00:00Z", fin: "2026-11-21T10:00:00Z" })).rejects.toThrow(/Début/);
    await expect(ajouter({ texte: "Texte correct.", fin: "2026-11-21T10:00:00Z", emplacement: "carte" })).rejects.toThrow(/Emplacement/);
    await expect(ajouter({ texte: "Texte correct.", fin: "2026-11-21T10:00:00Z" }, ids.service)).rejects.toThrow(/gérant/);
    for (let i = 0; i < 5; i++) await ajouter({ texte: `Message ${i + 1}.`, fin: "2026-11-21T10:00:00Z" });
    await expect(ajouter({ texte: "Un de trop.", fin: "2026-11-21T10:00:00Z" })).rejects.toThrow(/Cinq messages/);
  });

  it("table et fonctions fermées aux visiteurs", async () => {
    const t = await db.query<{ ok: boolean }>("select has_table_privilege('anon', 'messages_clients', 'select') or has_table_privilege('authenticated', 'messages_clients', 'select') as ok");
    expect(t.rows[0].ok).toBe(false);
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p where p.proname in ('ajouter_message_client', 'retirer_message_client', 'messages_actifs', 'messages_gestion')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });
});
