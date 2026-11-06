import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { regrouperParCategorie, type LignePlat } from "@/lib/carte";
import { creerBaseLocale, lireCommeVisiteur } from "@/lib/db/locale";

// La référence est le fichier de carte proposé, jamais un prix écrit dans le test.
const carte = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "carte-proposee.json"), "utf8"));

let db: PGlite;
beforeAll(async () => {
  db = await creerBaseLocale();
});

describe("amorçage de la carte", () => {
  it("contient chaque plat du fichier proposé, au prix proposé", async () => {
    const { rows } = await db.query<{ slug: string; prix_centimes: number }>("select slug, prix_centimes from plats");
    expect(rows).toHaveLength(carte.plats.length);
    const enBase = new Map(rows.map((r) => [r.slug, r.prix_centimes]));
    for (const p of carte.plats) expect(enBase.get(p.id), p.nom).toBe(Math.round(p.prixPropose * 100));
  });

  it("marque tous les prix comme à valider", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from plats where not prix_a_valider");
    expect(rows[0].n).toBe(0);
    const supp = await db.query<{ n: number }>("select count(*)::int as n from options where not prix_a_valider");
    expect(supp.rows[0].n).toBe(0);
  });

  it("n'affiche aucune mention « maison »", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from plats where description ilike '%maison%'");
    expect(rows[0].n).toBe(0);
  });

  it("relie les suppléments aux pizzas et le choix des pâtes aux plats concernés", async () => {
    for (const [cle, slug] of [["g1", "supplements-pizza"], ["g2", "choix-pates"]]) {
      const attendus = carte.plats.filter((p: { groupes: string[] }) => p.groupes.includes(cle)).length;
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from plat_groupes pg join groupes_options g on g.id = pg.groupe_id where g.slug = $1",
        [slug],
      );
      expect(rows[0].n).toBe(attendus);
    }
  });
});

describe("sécurité par ligne", () => {
  it("laisse un visiteur lire la carte", async () => {
    const lignes = await lireCommeVisiteur<LignePlat>(db, "select * from carte_publique");
    expect(lignes).toHaveLength(carte.plats.length);
    const categories = regrouperParCategorie(lignes);
    expect(categories.map((c) => c.slug)).toEqual(["pizzas", "entrees", "pates", "poissons", "viandes", "desserts", "boissons"]);
  });

  it("refuse toute écriture à un visiteur", async () => {
    const empreinte = async () =>
      (
        await db.query(
          "select (select sum(prix_centimes) from plats) as plats, (select count(*) from plats) as nb, (select count(*) from categories) as cats, (select sum(prix_centimes) from options) as options",
        )
      ).rows[0];
    const avant = await empreinte();
    for (const sql of [
      "update plats set prix_centimes = 0",
      "delete from plats",
      "insert into categories (slug, nom, ordre) values ('x', 'x', 99)",
      "update options set prix_centimes = 0",
    ]) {
      await db
        .transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        })
        .catch(() => undefined);
    }
    expect(await empreinte()).toEqual(avant);
  });

  it("cache un plat non commandable", async () => {
    await db.exec("update plats set commandable = false where slug = 'coca-cola'");
    const lignes = await lireCommeVisiteur<LignePlat>(db, "select slug from carte_publique");
    expect(lignes.map((l) => l.slug)).not.toContain("coca-cola");
    await db.exec("update plats set commandable = true where slug = 'coca-cola'");
  });

  it("réserve la liste des blocages à la clé de service", async () => {
    await expect(lireCommeVisiteur(db, "select * from plats_bloquants")).rejects.toThrow(/permission/);
  });
});

describe("blocage de la mise en production", () => {
  it("bloque tant que des prix ne sont pas validés", async () => {
    const { rows } = await db.query<{ motif: string }>("select distinct motif from plats_bloquants where motif = 'prix à valider'");
    expect(rows).toHaveLength(1);
  });

  it("libère un plat entièrement validé", async () => {
    const slug = carte.plats.find((p: { groupes: string[]; provenancesManquantes: string[] }) => !p.groupes.length && !p.provenancesManquantes.length).id;
    await db.exec(`update plats set prix_a_valider = false, allergenes = 'test' where slug = '${slug}'`);
    const { rows } = await db.query("select * from plats_bloquants where slug = $1", [slug]);
    expect(rows).toHaveLength(0);
  });
});

describe("retraits", () => {
  it("bloquent la mise en production tant qu'ils ne sont pas validés", async () => {
    const { rows } = await db.query("select * from plats_bloquants where motif = 'retraits à valider'");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("configuration Supabase", () => {
  it("refuse une configuration à moitié remplie au lieu de servir la base embarquée", async () => {
    const { chargerCarte } = await import("@/lib/carte");
    const avant = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    await expect(chargerCarte()).rejects.toThrow(/incomplète/);
    if (avant === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = avant;
  });
});
