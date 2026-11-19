import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Teneur en alcool obligatoire pour vendre une boisson (supabase/migrations/20261217220000_teneur_obligatoire.sql) :
// sans teneur, une boisson se vendrait au taux réduit. 0 est admis ; aucune teneur n'est posée d'office.

let db: PGlite;
let gerant: string;
const MOTIF = "teneur en alcool à saisir (0 pour une boisson sans alcool)";

async function q<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(sql, v)).rows[0].r;
}
const motifs = (slug: string) => q<string[]>("select motifs_plat(id) as r from plats where slug = $1", [slug]);
const enVente = (slug: string, oui: boolean) => db.query("update plats set commandable = $2 where slug = $1", [slug, oui]);

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  await db.query(
    "insert into plats (slug, categorie_id, nom, prix_centimes, station, commandable) select 'vin-essai', id, 'Vin essai', 900, 'comptoir', false from categories where slug = 'boissons'",
  );
}, 120_000);

describe("teneur en alcool obligatoire pour une boisson en vente", () => {
  it("une boisson sans teneur ne se met pas en vente, et la fiche dit pourquoi", async () => {
    expect(await motifs("vin-essai")).toContain(MOTIF);
    await expect(enVente("vin-essai", true)).rejects.toThrow(/teneur_a_saisir/);
  });

  it("0 % vol. est admis : la boisson sans alcool se met en vente, le motif part", async () => {
    await db.query("select regler_teneur_alcool('vin-essai', 0, $1)", [gerant]);
    expect(await motifs("vin-essai")).not.toContain(MOTIF);
    await enVente("vin-essai", true);
    // Vider la teneur d'une boisson en vente est refusé, rien n'est écrit.
    await expect(db.query("select regler_teneur_alcool('vin-essai', null, $1)", [gerant])).rejects.toThrow(/teneur_a_saisir/);
    expect(Number(await q<string>("select teneur_alcool as r from plats where slug = 'vin-essai'"))).toBe(0);
    await enVente("vin-essai", false);
  });

  it("un plat en vente sans teneur qui passe dans Boissons est refusé ; hors Boissons, rien ne change", async () => {
    expect(await motifs("pizza-margherita")).not.toContain(MOTIF);
    await expect(
      db.query("update plats set categorie_id = (select id from categories where slug = 'boissons') where slug = 'pizza-margherita'"),
    ).rejects.toThrow(/teneur_a_saisir/);
  });

  it("un plat créé au back-office dans Boissons naît hors de la vente tant que la teneur manque", async () => {
    const r = await q<{ commandable: boolean; manques: string[] }>("select ajouter_plat($1, $2) as r", [
      { categorie: "boissons", slug: "limonade-essai", nom: "Limonade essai", prix_centimes: 400, prix_valide: true, station: "comptoir", allergenes: "aucun", commandable: true },
      gerant,
    ]);
    expect(r.commandable).toBe(false);
    expect(r.manques).toContain(MOTIF);
  });

  it("le jeu de test donne une teneur à ses boissons en vente : aucune ne bloque pour ce motif", async () => {
    const bloquees = (await db.query<{ slug: string }>("select slug from plats_bloquants where motif = $1", [MOTIF])).rows;
    expect(bloquees).toEqual([]);
  });
});
