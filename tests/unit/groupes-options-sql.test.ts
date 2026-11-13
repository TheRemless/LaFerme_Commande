import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { champsGroupe, nomOption, nomsOptions } from "@/lib/gestion-options";

// Groupes d'options gérés au back-office (supabase/migrations/20261210100000_groupes_options.sql).
// Montants d'essai, aucun prix de la carte.

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
async function dernierJournal() {
  return (await db.query<{ objet: string; cle: string; avant: unknown; apres: unknown }>("select objet, cle, avant, apres from journal_gestion order by id desc limit 1")).rows[0];
}
async function optionsPubliques(groupe: string) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<{ nom: string; par_defaut: boolean; ordre: number; choix_min: number; choix_max: number; groupe_nom: string }>(
      "select * from options_publiques where groupe_slug = $1 order by ordre", [groupe])).rows;
  });
}
async function groupesDuPlat(slug: string): Promise<string[]> {
  return (await db.query<{ slug: string }>("select g.slug from plat_groupes pg join plats p on p.id = pg.plat_id join groupes_options g on g.id = pg.groupe_id where p.slug = $1 order by pg.ordre", [slug])).rows.map((r) => r.slug);
}
// Trois options d'essai, prix validés sauf demande contraire.
async function sauce(prixValides = true): Promise<string> {
  const s = await f<string>("ajouter_groupe('sauce', $1, $2)", [{ nom: "Sauce", choix_min: 1, choix_max: 1 }, gerant]);
  for (const nom of ["Poivre", "Morilles", "Gorgonzola"]) await f("ajouter_option($1, $2, 0, $3, $4)", [s, nom, prixValides, gerant]);
  return s;
}

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("groupe neuf", () => {
  it("se crée, reçoit ses options, se réutilise sur plusieurs plats, journalisé", async () => {
    const s = await sauce();
    expect(s).toBe("sauce");
    expect(await dernierJournal()).toMatchObject({ objet: "option", cle: "sauce/Gorgonzola" });
    expect(await f("lier_groupe('sauce', $1, $2)", [["pizza-tonno", "pizza-margherita"], gerant])).toBe(true);
    expect(await groupesDuPlat("pizza-tonno")).toContain("sauce");
    expect(await groupesDuPlat("pizza-margherita")).toEqual(expect.arrayContaining(["supplements-pizza", "sauce"]));
    expect((await groupesDuPlat("pizza-margherita")).at(-1)).toBe("sauce");
    expect(await dernierJournal()).toMatchObject({ objet: "groupe_plats", cle: "sauce", avant: { plats: [] }, apres: { plats: ["pizza-margherita", "pizza-tonno"] } });
    // La liste est complète : un plat absent perd le groupe.
    await f("lier_groupe('sauce', $1, $2)", [["pizza-tonno"], gerant]);
    expect(await groupesDuPlat("pizza-margherita")).not.toContain("sauce");
    const g = await f<{ groupes: { slug: string; plats: string[] }[] }>("gestion_carte()");
    expect(g.groupes.find((x) => x.slug === "sauce")?.plats).toEqual(["pizza-tonno"]);
  });

  it("un nom pris est refusé, un slug pris reçoit un suffixe", async () => {
    await sauce();
    expect(await erreur("ajouter_groupe('sauce-2', $1, $2)", [{ nom: "sauce", choix_min: 0, choix_max: 1 }, gerant])).toContain("groupe_existe");
    expect(await f("ajouter_groupe('sauce', $1, $2)", [{ nom: "Sauces froides", choix_min: 0, choix_max: 2 }, gerant])).toBe("sauce-2");
  });

  it("refuse des bornes impossibles, un nom vide, un membre du service", async () => {
    expect(await erreur("ajouter_groupe('x', $1, $2)", [{ nom: "Cuisson", choix_min: 2, choix_max: 1 }, gerant])).toContain("bornes_invalides");
    expect(await erreur("ajouter_groupe('x', $1, $2)", [{ nom: "Cuisson", choix_min: 0, choix_max: 0 }, gerant])).toContain("bornes_invalides");
    expect(await erreur("ajouter_groupe('x', $1, $2)", [{ nom: "  ", choix_min: 0, choix_max: 1 }, gerant])).toContain("nom_invalide");
    expect(await erreur("ajouter_groupe('x', $1, $2)", [{ nom: "Cuisson", choix_min: 0, choix_max: 1 }, service])).toContain("Réservé au gérant");
    expect(await erreur("lier_groupe('supplements-pizza', $1, $2)", [["plat-inconnu"], gerant])).toContain("plat_inconnu");
    expect(await f("lier_groupe('groupe-inconnu', $1, $2)", [[], gerant])).toBe(false);
  });
});

describe("réglages d'un groupe", () => {
  it("minimum, maximum et nom ; le site les lit", async () => {
    await sauce();
    expect(await f("modifier_groupe('sauce', $1, $2)", [{ nom: "Sauce au choix", choix_min: 0, choix_max: 2 }, gerant])).toBe(true);
    expect((await optionsPubliques("sauce"))[0]).toMatchObject({ groupe_nom: "Sauce au choix", choix_min: 0, choix_max: 2 });
    expect(await dernierJournal()).toMatchObject({ objet: "groupe", cle: "sauce", avant: { choix_min: 1, choix_max: 1 }, apres: { choix_min: 0, choix_max: 2 } });
  });

  it("refuse un minimum que les options proposées ne remplissent pas quand un plat en vente porte le groupe", async () => {
    await sauce();
    await f("lier_groupe('sauce', $1, $2)", [["pizza-tonno"], gerant]);
    expect(await erreur("modifier_groupe('sauce', $1, $2)", [{ choix_min: 4, choix_max: 4 }, gerant])).toContain("choix_impossible");
    expect(await f("modifier_groupe('sauce', $1, $2)", [{ choix_min: 3, choix_max: 3 }, gerant])).toBe(true);
  });

  it("options cochées d'avance : au plus le maximum, options proposées seulement, lues par le site", async () => {
    await sauce();
    expect(await f("regler_defauts('sauce', $1, $2)", [["Poivre"], gerant])).toBe(true);
    expect((await optionsPubliques("sauce")).filter((o) => o.par_defaut).map((o) => o.nom)).toEqual(["Poivre"]);
    expect(await dernierJournal()).toMatchObject({ objet: "groupe_defauts", avant: { par_defaut: [] }, apres: { par_defaut: ["Poivre"] } });
    expect(await erreur("regler_defauts('sauce', $1, $2)", [["Poivre", "Morilles"], gerant])).toContain("trop_de_defauts");
    expect(await erreur("regler_defauts('sauce', $1, $2)", [["Ketchup"], gerant])).toContain("option_inconnue");
    // Le maximum ne descend pas sous le nombre d'options cochées.
    await f("modifier_groupe('sauce', $1, $2)", [{ choix_max: 2 }, gerant]);
    await f("regler_defauts('sauce', $1, $2)", [["Poivre", "Morilles"], gerant]);
    expect(await erreur("modifier_groupe('sauce', $1, $2)", [{ choix_max: 1 }, gerant])).toContain("trop_de_defauts");
    await f("regler_defauts('sauce', $1, $2)", [[], gerant]);
    expect((await optionsPubliques("sauce")).some((o) => o.par_defaut)).toBe(false);
  });

  it("ordre et nom des options", async () => {
    await sauce();
    expect(await f("ordonner_options('sauce', $1, $2)", [["Gorgonzola"], gerant])).toBe(true);
    expect((await optionsPubliques("sauce")).map((o) => o.nom)).toEqual(["Gorgonzola", "Poivre", "Morilles"]);
    expect(await f("renommer_option('sauce', 'Poivre', $1, $2)", ["Sauce au poivre", gerant])).toBe(true);
    expect((await optionsPubliques("sauce")).map((o) => o.nom)).toContain("Sauce au poivre");
    expect(await dernierJournal()).toMatchObject({ objet: "option_nom", avant: { nom: "Poivre" }, apres: { nom: "Sauce au poivre" } });
    expect(await erreur("renommer_option('sauce', 'Morilles', $1, $2)", ["gorgonzola", gerant])).toContain("option_existe");
    expect(await f("renommer_option('sauce', 'Inconnue', $1, $2)", ["X", gerant])).toBe(false);
  });
});

describe("verrou de mise en vente", () => {
  it("un plat du back-office en vente ne reçoit pas un groupe dont un prix est à valider", async () => {
    const p = { slug: "risotto-essai", categorie: "pates", nom: "Risotto d'essai", description: "", prix_centimes: 100, prix_valide: true, station: "cuisine", provenance: "", provenances_a_fournir: [], allergenes: "lait", retraits: [], groupes: [], commandable: true };
    await f("ajouter_plat($1, $2)", [p, gerant]);
    expect((await db.query<{ commandable: boolean }>("select commandable from plats where slug = 'risotto-essai'")).rows[0].commandable).toBe(true);
    await sauce(false);
    expect(await erreur("lier_groupe('sauce', $1, $2)", [["risotto-essai"], gerant])).toContain("plat_incomplet");
    expect(await groupesDuPlat("risotto-essai")).toEqual([]);
    // Prix des options validés : le groupe passe.
    for (const nom of ["Poivre", "Morilles", "Gorgonzola"]) await f("modifier_option('sauce', $1, $2, $3)", [nom, { prix_valide: true }, gerant]);
    expect(await f("lier_groupe('sauce', $1, $2)", [["risotto-essai"], gerant])).toBe(true);
  });

  it("un visiteur n'appelle aucune des fonctions neuves", async () => {
    for (const fn of ["ajouter_groupe(text, jsonb, uuid)", "modifier_groupe(text, jsonb, uuid)", "regler_defauts(text, text[], uuid)", "ordonner_options(text, text[], uuid)", "renommer_option(text, text, text, uuid)", "lier_groupe(text, text[], uuid)"]) {
      expect(await f("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
    }
  });
});

describe("saisie du back-office", () => {
  it("valide un groupe neuf ou modifié", () => {
    expect(champsGroupe({ nom: " Sauce  au choix ", choix_min: 0, choix_max: 2 }, true)).toEqual({ ok: true, valeur: { nom: "Sauce au choix", choix_min: 0, choix_max: 2 } });
    expect(champsGroupe({ choix_max: 3 }, false)).toEqual({ ok: true, valeur: { choix_max: 3 } });
    expect(champsGroupe({ choix_max: 3 }, true)).toMatchObject({ ok: false });
    expect(champsGroupe({ nom: "Sauce", choix_min: 2, choix_max: 1 }, true)).toMatchObject({ ok: false });
    expect(champsGroupe({ nom: "Sauce", choix_min: 0, choix_max: 21 }, true)).toMatchObject({ ok: false });
    expect(champsGroupe({ nom: "Sauce", choix_min: 0.5, choix_max: 1 }, true)).toMatchObject({ ok: false });
    expect(champsGroupe(null, false)).toMatchObject({ ok: false });
  });

  it("valide les listes et noms d'options", () => {
    expect(nomsOptions(["Poivre", "Morilles"])).toEqual(["Poivre", "Morilles"]);
    expect(nomsOptions([])).toEqual([]);
    expect(nomsOptions(["Poivre", "Poivre"])).toBeNull();
    expect(nomsOptions([""])).toBeNull();
    expect(nomsOptions("Poivre")).toBeNull();
    expect(nomOption("  Sauce   au poivre ")).toBe("Sauce au poivre");
    expect(nomOption("x".repeat(61))).toBeNull();
  });
});
