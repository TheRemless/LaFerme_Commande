import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Menus et formules (supabase/migrations/20261210240000_menus.sql), construits désactivés. Montants d'essai
// posés par le test : aucun prix de la carte ni de menu de La Ferme.

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
const ETAPES = [
  { nom: "Une pizza au choix", categorie: "pizzas", plats: [{ slug: "pizza-tonno", supplement_centimes: 300 }] },
  { nom: "Un dessert", plats: [{ slug: "tiramisu" }] },
];
async function menu(actif = true): Promise<string> {
  const s = await f<string>("creer_menu('formule-essai', $1, $2)", [{ nom: "Formule d'essai", prix_centimes: 2500, prix_valide: true }, gerant]);
  await f("regler_etapes($1, $2, $3)", [s, ETAPES, gerant]);
  if (actif) await f("modifier_menu($1, $2, $3)", [s, { actif: true }, gerant]);
  return s;
}

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("désactivé par défaut", () => {
  it("l'interrupteur est faux, un menu naît inactif et son prix à valider sans « Prix validé »", async () => {
    expect(await f("(select valeur from reglages where cle = 'menus_actifs')")).toBe(false);
    const s = await f<string>("creer_menu('midi', $1, $2)", [{ nom: "Menu de midi", prix_centimes: 1900 }, gerant]);
    const g = await f<{ actifs: boolean; menus: { slug: string; actif: boolean; prix_a_valider: boolean; manques: string[] }[] }>("menus_gestion()");
    expect(g.actifs).toBe(false);
    expect(g.menus.find((m) => m.slug === s)).toMatchObject({ actif: false, prix_a_valider: true, manques: ["prix à valider", "aucune étape"] });
    const m = await menu();
    expect(await f("menus_publics()")).toEqual([]);
    expect(await f("prix_menu($1, $2)", [m, [["pizza-margherita"], ["tiramisu"]]])).toEqual({ ok: false, raison: "desactive" });
  });
});

describe("règles du menu", () => {
  it("ne s'active pas incomplet ; un prix changé repart à valider ; journalisé", async () => {
    const s = await f<string>("creer_menu('formule', $1, $2)", [{ nom: "Formule", prix_centimes: 2000 }, gerant]);
    expect(await erreur("modifier_menu($1, $2, $3)", [s, { actif: true }, gerant])).toContain("menu_incomplet: prix à valider, aucune étape");
    await f("regler_etapes($1, $2, $3)", [s, [{ nom: "Vide" }], gerant]);
    expect(await erreur("modifier_menu($1, $2, $3)", [s, { prix_valide: true, actif: true }, gerant])).toContain("étape sans plat");
    await f("regler_etapes($1, $2, $3)", [s, ETAPES, gerant]);
    expect(await f("modifier_menu($1, $2, $3)", [s, { prix_valide: true, actif: true }, gerant])).toBe(true);
    await f("modifier_menu($1, $2, $3)", [s, { actif: false, prix_centimes: 2100 }, gerant]);
    expect((await db.query<{ prix_a_valider: boolean }>("select prix_a_valider from menus where slug = $1", [s])).rows[0].prix_a_valider).toBe(true);
    const objets = (await db.query<{ objet: string }>("select distinct objet from journal_gestion")).rows.map((r) => r.objet).sort();
    expect(objets).toEqual(["menu", "menu_etapes"]);
  });

  it("refuse une catégorie ou un plat inconnu, trop d'étapes, un membre du service", async () => {
    const s = await f<string>("creer_menu('x', $1, $2)", [{ nom: "X", prix_centimes: 100 }, gerant]);
    expect(await erreur("regler_etapes($1, $2, $3)", [s, [{ nom: "A", categorie: "inconnue" }], gerant])).toContain("categorie_inconnue");
    expect(await erreur("regler_etapes($1, $2, $3)", [s, [{ nom: "A", plats: [{ slug: "inconnu" }] }], gerant])).toContain("plat_inconnu");
    expect(await erreur("regler_etapes($1, $2, $3)", [s, Array.from({ length: 7 }, (_, i) => ({ nom: `E${i}`, categorie: "pizzas" })), gerant])).toContain("etapes_invalides");
    expect(await erreur("regler_etapes($1, $2, $3)", [s, [{ nom: "A", categorie: "pizzas", choix_min: 2, choix_max: 1 }], gerant])).toContain("check");
    expect(await erreur("creer_menu('y', $1, $2)", [{ nom: "Y", prix_centimes: 100 }, service])).toContain("Réservé au gérant");
    expect(await erreur("creer_menu('z', $1, $2)", [{ nom: "Z", prix_centimes: 0 }, gerant])).toContain("check");
  });
});

describe("prix d'un choix (interrupteur ouvert)", () => {
  beforeEach(() => f("activer_menus(true, $1)", [gerant]));

  it("prix du menu plus les suppléments des plats choisis", async () => {
    const s = await menu();
    expect(await f("prix_menu($1, $2)", [s, [["pizza-margherita"], ["tiramisu"]]])).toMatchObject({ ok: true, prix_centimes: 2500 });
    expect(await f("prix_menu($1, $2)", [s, [["pizza-tonno"], ["tiramisu"]]])).toMatchObject({ ok: true, prix_centimes: 2800 });
    expect((await f<unknown[]>("menus_publics()")).length).toBe(1);
  });

  it("refuse un nombre de choix faux, un plat pas proposé, un plat épuisé, un menu inactif", async () => {
    const s = await menu();
    expect(await f("prix_menu($1, $2)", [s, [["pizza-margherita"]]])).toEqual({ ok: false, raison: "choix_invalides" });
    expect(await f("prix_menu($1, $2)", [s, [[], ["tiramisu"]]])).toMatchObject({ ok: false, raison: "nombre", etape: "Une pizza au choix" });
    expect(await f("prix_menu($1, $2)", [s, [["lasagne-de-boeuf"], ["tiramisu"]]])).toMatchObject({ ok: false, raison: "pas_propose" });
    await f("regler_rupture('pizza-margherita', true, $1)", [service]);
    expect(await f("prix_menu($1, $2)", [s, [["pizza-margherita"], ["tiramisu"]]])).toMatchObject({ ok: false, raison: "epuise", plat: "Pizza Margherita" });
    await f("modifier_menu($1, $2, $3)", [s, { actif: false }, gerant]);
    expect(await f("prix_menu($1, $2)", [s, [["pizza-tonno"], ["tiramisu"]]])).toEqual({ ok: false, raison: "inconnu" });
  });

  it("un menu archivé quitte la vente et se remet inactif", async () => {
    const s = await menu();
    await f("archiver_menu($1, true, $2)", [s, gerant]);
    expect(await f("menus_publics()")).toEqual([]);
    expect(await erreur("modifier_menu($1, $2, $3)", [s, { actif: true }, gerant])).toContain("menu_archive");
    await f("archiver_menu($1, false, $2)", [s, gerant]);
    expect((await db.query<{ actif: boolean; archive_le: unknown }>("select actif, archive_le from menus where slug = $1", [s])).rows[0]).toEqual({ actif: false, archive_le: null });
  });
});

describe("droits", () => {
  it("un visiteur ne lit pas les menus et n'appelle aucune fonction", async () => {
    for (const t of ["menus", "menu_etapes", "menu_etape_plats"]) expect(await f("has_table_privilege('anon', $1, 'select')", [t])).toBe(false);
    for (const fn of ["prix_menu(text, jsonb)", "menus_publics()", "creer_menu(text, jsonb, uuid)", "activer_menus(boolean, uuid)"]) {
      expect(await f("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
    }
  });
});
