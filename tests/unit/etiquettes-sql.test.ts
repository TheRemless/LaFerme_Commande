import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Étiquettes des plats (supabase/migrations/20261210150000_etiquettes.sql) : posées par le gérant, jamais déduites.

let db: PGlite;
let gerant: string;
let service: string;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function erreur(sql: string, v: unknown[] = []): Promise<string> {
  try {
    await f(sql, v);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "aucune erreur";
}
async function publiques(slug: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<{ etiquettes: string[] }>("select etiquettes from carte_publique where slug = $1", [slug])).rows[0].etiquettes;
  });
}

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("étiquettes", () => {
  it("aucune par défaut : rien n'est déduit de la carte", async () => {
    expect(await f("(select count(*)::int from plats where cardinality(etiquettes) > 0)")).toBe(0);
    expect(await publiques("pizza-margherita")).toEqual([]);
  });

  it("le gérant les pose ; végane ajoute végétarien ; le site et le back-office les lisent ; journalisé", async () => {
    expect(await f("regler_etiquettes('pizza-margherita', $1, $2)", [["vegane", "epice"], gerant])).toBe(true);
    expect(await publiques("pizza-margherita")).toEqual(["epice", "vegane", "vegetarien"]);
    const g = await f<{ categories: { plats: { slug: string; etiquettes: string[] }[] }[] }>("gestion_carte()");
    expect(g.categories.flatMap((c) => c.plats).find((p) => p.slug === "pizza-margherita")?.etiquettes).toEqual(["epice", "vegane", "vegetarien"]);
    const j = (await db.query<{ objet: string; avant: unknown; apres: unknown }>("select objet, avant, apres from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toMatchObject({ objet: "etiquettes", avant: { etiquettes: [] }, apres: { etiquettes: ["epice", "vegane", "vegetarien"] } });
    await f("regler_etiquettes('pizza-margherita', $1, $2)", [[], gerant]);
    expect(await publiques("pizza-margherita")).toEqual([]);
  });

  it("refuse une étiquette inconnue, un membre du service ; un plat inconnu rend faux", async () => {
    expect(await erreur("regler_etiquettes('pizza-margherita', $1, $2)", [["sans_gluten"], gerant])).toContain("etiquette_inconnue");
    expect(await erreur("regler_etiquettes('pizza-margherita', $1, $2)", [["epice"], service])).toContain("Réservé au gérant");
    expect(await f("regler_etiquettes('inconnu', $1, $2)", [["epice"], gerant])).toBe(false);
    expect(await f("has_function_privilege('anon', 'regler_etiquettes(text, text[], uuid)', 'execute')")).toBe(false);
  });
});
