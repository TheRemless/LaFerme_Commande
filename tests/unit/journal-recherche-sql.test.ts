import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { FiltresJournal, PageJournal } from "@/lib/journal";

// Journal du back-office avec filtres (migration 20261129130000_journal_recherche.sql).

let db: PGlite;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function ligne(nom: string, objet: string, cle: string, apres: unknown, le: string) {
  await db.query("insert into journal_gestion (personnel_nom, objet, cle, avant, apres, le) values ($1, $2, $3, null, $4, $5::timestamptz)", [nom, objet, cle, JSON.stringify(apres), le]);
}
const chercher = (p: Record<string, unknown>) => f<PageJournal>("journal_gestion_chercher($1)", [p]);

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.query("delete from journal_gestion where true");
  await ligne("Giuseppe", "plat", "pizza-margherita", { prix_centimes: 2100 }, "2026-12-03T18:00:00Z");
  await ligne("Giuseppe", "zone", "2", { frais_centimes: 690 }, "2026-12-04T09:00:00Z");
  await ligne("Jérémy", "plat", "lasagne-de-boeuf", { nom: "Lasagne 100%_maison" }, "2026-12-04T22:30:00Z"); // 23h30 le 4.12 à Genève
  await ligne("Jérémy", "cloture", "2026-12-04", { ecart_centimes: 0 }, "2026-12-04T23:30:00Z"); // 0h30 le 5.12
});

describe("journal avec filtres", () => {
  it("filtre par auteur, objet et jours à Genève, du plus récent au plus ancien", async () => {
    expect((await chercher({ auteur: "Jérémy" })).entrees.map((e) => e.cle)).toEqual(["2026-12-04", "lasagne-de-boeuf"]);
    expect((await chercher({ objet: "plat" })).entrees.map((e) => e.cle)).toEqual(["lasagne-de-boeuf", "pizza-margherita"]);
    expect((await chercher({ debut: "2026-12-04", fin: "2026-12-04" })).entrees.map((e) => e.cle)).toEqual(["lasagne-de-boeuf", "2"]);
    expect((await chercher({})).entrees[0]).not.toHaveProperty("personnel_id");
  });

  it("cherche dans la clé et les valeurs, % et _ comme du texte, sans tenir compte des majuscules", async () => {
    expect((await chercher({ recherche: "MARGHERITA" })).entrees.map((e) => e.cle)).toEqual(["pizza-margherita"]);
    expect((await chercher({ recherche: "100%_m" })).entrees.map((e) => e.cle)).toEqual(["lasagne-de-boeuf"]);
    expect((await chercher({ recherche: "%" })).entrees.map((e) => e.cle)).toEqual(["lasagne-de-boeuf"]);
    expect((await chercher({ recherche: "690" })).entrees.map((e) => e.cle)).toEqual(["2"]);
  });

  it("page par page avec un curseur", async () => {
    const p1 = await chercher({ limite: 3 });
    expect(p1.entrees).toHaveLength(3);
    expect(p1.suivant).toBe(p1.entrees[2].id);
    const p2 = await chercher({ limite: 3, avant_id: p1.suivant });
    expect(p2.entrees.map((e) => e.cle)).toEqual(["pizza-margherita"]);
    expect(p2.suivant).toBeNull();
  });

  it("liste les auteurs et les objets présents, refuse une période à l'envers, aucun droit pour un visiteur", async () => {
    const filtres = await f<FiltresJournal>("journal_gestion_filtres()");
    expect(filtres.auteurs).toEqual([{ nom: "Giuseppe", lignes: 2 }, { nom: "Jérémy", lignes: 2 }]);
    expect(filtres.objets[0]).toEqual({ objet: "plat", lignes: 2 });
    await expect(chercher({ debut: "2026-12-05", fin: "2026-12-04" })).rejects.toThrow(/periode_invalide/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select journal_gestion_chercher('{}'::jsonb)");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
