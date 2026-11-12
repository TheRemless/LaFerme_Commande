import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { champsPlat, champsPlatDuJour, champsOption } from "@/lib/gestion";

// Décisions de Jérémy après l'audit de sécurité 2 (migration 20261122090000_securite_2_decisions.sql) :
// prix repassé « à valider » hors de la vente (S2-02), aucun plat à 0 (S2-10), session d'un livreur de
// 12 heures (S2-15). Annulation d'une livraison partie : tests/unit/livreurs-sql.test.ts (S2-01).
// Les montants sont des montants d'essai, pas des prix de la carte.

let db: PGlite;
let gerant: string;
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
const etat = async (slug: string) =>
  (await db.query<{ commandable: boolean; prix_a_valider: boolean; retire_prix_a_valider: boolean; prix_centimes: number }>(
    "select commandable, prix_a_valider, retire_prix_a_valider, prix_centimes from plats where slug = $1",
    [slug],
  )).rows[0];
const id = async (email: string) => (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
async function publics(): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<{ slug: string }>("select slug from carte_publique")).rows.map((r) => r.slug);
  });
}

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = await id("equipe@laferme.test");
});

describe("S2-02 : un prix repassé « à valider » sort le plat de la vente jusqu'à validation", () => {
  it("plat de la carte validé, nouveau prix sans validation : hors de la vente, ne bloque pas le build, revient validé", async () => {
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_valide: true }, gerant]);
    const avant = await etat("pizza-margherita");
    expect(avant).toMatchObject({ commandable: true, prix_a_valider: false });

    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: 180, commandable: true }, gerant]);
    expect(await etat("pizza-margherita")).toMatchObject({ commandable: false, prix_a_valider: true, retire_prix_a_valider: true });
    expect(await publics()).not.toContain("pizza-margherita");
    expect((await db.query("select 1 from plats_bloquants where slug = 'pizza-margherita'")).rows).toHaveLength(0);

    // Remis en vente à la main sans valider : refusé.
    expect(await erreur("modifier_plat('pizza-margherita', $1, $2)", [{ commandable: true }, gerant])).toContain("plat_incomplet: prix à valider");

    // Validé (la fiche renvoie la vente telle qu'elle est, donc false) : retour en vente.
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: avant.prix_centimes, prix_valide: true, commandable: false }, gerant]);
    expect(await etat("pizza-margherita")).toMatchObject({ commandable: true, prix_a_valider: false, retire_prix_a_valider: false });
    expect(await publics()).toContain("pizza-margherita");
  });

  it("avant le lancement, un plat de la carte jamais validé reste en vente (le build le bloque)", async () => {
    const e = await etat("pizza-margherita");
    expect(e.prix_a_valider).toBe(true);
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ description: "Essai." }, gerant]);
    expect((await etat("pizza-margherita")).commandable).toBe(true);
    expect((await db.query("select 1 from plats_bloquants where slug = 'pizza-margherita'")).rows.length).toBeGreaterThan(0);
  });

  it("l'import du tableau valide un nouveau prix en une fois, sans sortir le plat de la vente", async () => {
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_valide: true }, gerant]);
    const prix = (await etat("pizza-margherita")).prix_centimes + 100;
    await f("importer_validation($1, $2)", [{ plats: [{ slug: "pizza-margherita", prix_centimes: prix, prix_valide: true }] }, gerant]);
    expect(await etat("pizza-margherita")).toMatchObject({ commandable: true, prix_a_valider: false, prix_centimes: prix });
  });

  it("archivé pendant qu'il est hors de la vente : il ne revient pas seul à la validation", async () => {
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_valide: true }, gerant]);
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: 180 }, gerant]);
    expect(await f<boolean>("archiver_plat('pizza-margherita', true, $1)", [gerant])).toBe(true);
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_valide: true }, gerant]);
    expect((await etat("pizza-margherita")).commandable).toBe(false);
  });
});

describe("S2-10 : aucun plat à CHF 0", () => {
  it("refusé par le back-office pour un plat et un plat du jour, permis pour une option", () => {
    expect(champsPlat({ prix: 0 }).ok).toBe(false);
    expect(champsPlat({ prix: "0.00" }).ok).toBe(false);
    expect(champsPlatDuJour({ nom: "Essai", prix: 0, station: "cuisine", jour: "2026-11-12", service: "journee" }, "2026-11-12").ok).toBe(false);
    expect(champsPlat({ prix: 0.05 }).ok).toBe(true);
    expect(champsOption({ prix: 0 }).ok).toBe(true);
  });

  it("refusé par la base, plat de la carte comme plat du jour", async () => {
    expect(await erreur("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: 0, prix_valide: true }, gerant])).toContain("plats_prix_positif");
    const jour = (await db.query<{ d: string }>("select to_char((now() at time zone 'Europe/Zurich')::date, 'YYYY-MM-DD') d")).rows[0].d;
    expect(
      await erreur("ajouter_plat_du_jour($1, $2)", [{ slug: `jour-${jour}-essai`, nom: "Essai", prix_centimes: 0, station: "cuisine", jour, service: "journee", allergenes: "Gluten", commandable: true }, gerant]),
    ).toContain("plats_prix_positif");
  });
});

describe("S2-15 : la session d'un livreur dure 12 heures", () => {
  it("expire 12 heures après la connexion pour un livreur, 60 jours pour la tablette", async () => {
    const marco = await id("marco@laferme.test");
    const service = await id("livraison@laferme.test");
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1, 'h-livreur', now() + interval '60 days'), ($2, 'h-service', now() + interval '60 days')", [marco, service]);
    const duree = async (h: string) => (await db.query<{ h: number }>("select extract(epoch from expire_le - cree_le) / 3600 h from sessions_personnel where jeton_hache = $1", [h])).rows[0].h;
    expect(Math.round(await duree("h-livreur"))).toBe(12);
    expect(Math.round(await duree("h-service"))).toBe(60 * 24);
  });

  it("un membre passé livreur perd une session de plus de 12 heures", async () => {
    const membre = await id("livraison@laferme.test");
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le, cree_le) values ($1, 'h-ancienne', now() + interval '50 days', now() - interval '13 hours')", [membre]);
    expect(await f("personnel_de_session('h-ancienne')")).not.toBeNull();
    await f("modifier_personnel($1, $2, $3)", [membre, { role: "livreur" }, gerant]);
    expect(await f("personnel_de_session('h-ancienne')")).toBeNull();
  });
});
