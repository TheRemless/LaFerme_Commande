import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Disponibilités et ruptures planifiées, côté base (supabase/migrations/20261128090000_disponibilites.sql).
// Les vues lient now() à leur création : on part du vrai jour de Genève (pg_catalog.now) et on déplace
// les dates pour simuler le temps qui passe. Montants d'essai, aucun prix de la carte.

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
async function ligneCarte(slug: string) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<Record<string, unknown>>("select * from carte_publique where slug = $1", [slug])).rows[0];
  });
}
async function optionPublique(nom: string) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<Record<string, unknown>>("select * from options_publiques where groupe_slug = 'supplements-pizza' and nom = $1", [nom])).rows[0];
  });
}
const jour = (decalage: number) => f<string>(`to_char((pg_catalog.now() at time zone 'Europe/Zurich')::date + ${decalage}, 'YYYY-MM-DD')`);
const texte = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("disponibilités d'un plat", () => {
  it("se règlent, s'affichent dans la carte publique et le back-office, et se journalisent", async () => {
    const p = { service: "soir", mode: "retrait", jours: [6, 5, 5] };
    expect(await f("regler_disponibilite('pizza-tonno', $1, $2)", [p, gerant])).toBe(true);
    const l = await ligneCarte("pizza-tonno");
    expect(l).toMatchObject({ dispo_service: "soir", dispo_mode: "retrait", dispo_jours: [5, 6] });
    const j = await dernierJournal();
    expect(j).toMatchObject({ objet: "disponibilite", cle: "pizza-tonno", avant: { service: null, mode: null, jours: null }, apres: { service: "soir", mode: "retrait", jours: [5, 6] } });
    const g = await f<{ categories: { plats: { slug: string; dispo: unknown }[] }[] }>("gestion_carte()");
    const fiche = g.categories.flatMap((c) => c.plats).find((x) => x.slug === "pizza-tonno");
    expect(fiche?.dispo).toEqual({ service: "soir", mode: "retrait", jours: [5, 6] });
  });

  it("sept jours cochés valent « tous les jours », null efface tout", async () => {
    await f("regler_disponibilite('pizza-tonno', $1, $2)", [{ jours: [1, 2, 3, 4, 5, 6, 7] }, gerant]);
    expect((await ligneCarte("pizza-tonno")).dispo_jours).toBeNull();
    await f("regler_disponibilite('pizza-tonno', $1, $2)", [{ service: "midi" }, gerant]);
    await f("regler_disponibilite('pizza-tonno', $1, $2)", [{ service: null, mode: null, jours: null }, gerant]);
    expect(await ligneCarte("pizza-tonno")).toMatchObject({ dispo_service: null, dispo_mode: null, dispo_jours: null });
  });

  it("refuse un membre du service, des valeurs inconnues, aucun jour, et le plat du jour", async () => {
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ service: "soir" }, service])).toContain("Réservé au gérant");
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ service: "nuit" }, gerant])).toContain("service_invalide");
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ mode: "drone" }, gerant])).toContain("mode_invalide");
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ jours: [] }, gerant])).toContain("jours_vides");
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ jours: [0, 8] }, gerant])).toContain("jours_invalides");
    expect(await erreur("regler_disponibilite('pizza-tonno', $1, $2)", [{ jours: "lundi" }, gerant])).toContain("jours_invalides");
    expect(await f("regler_disponibilite('plat-inconnu', $1, $2)", [{}, gerant])).toBe(false);
    const pj = await f<{ slug: string }>("ajouter_plat_du_jour($1, $2)", [
      { slug: "jour-essai", jour: await jour(0), service: "midi", nom: "Osso buco d'essai", description: "", prix_centimes: 2000, station: "cuisine", allergenes: "céleri", commandable: true },
      gerant,
    ]);
    expect(await erreur("regler_disponibilite($1, $2, $3)", [pj.slug, { service: "soir" }, gerant])).toContain("plat_du_jour");
    expect(await f("regler_disponibilite($1, $2, $3)", [pj.slug, { mode: "retrait" }, gerant])).toBe(true);
  });
});

describe("rupture planifiée", () => {
  it("un plat épuisé jusqu'à une date le reste pour la tablette, le site lit la date, puis il revient seul", async () => {
    const dans3 = await jour(3);
    expect(await f("planifier_rupture('pizza-tonno', $1::date, $2)", [dans3, gerant])).toBe(true);
    // rupture_motif ne couvre que la rupture du jour : le site compare la date au jour choisi.
    const l = await ligneCarte("pizza-tonno");
    expect(l.rupture_motif).toBeNull();
    expect(texte(l.rupture_jusqu_au)).toBe(dans3);
    const tablette = await f<{ slug: string; rupture: boolean; rupture_jusqu_au: string }[]>("plats_tablette()");
    expect(tablette.find((p) => p.slug === "pizza-tonno")).toMatchObject({ rupture: true, rupture_jusqu_au: dans3 });
    expect(await dernierJournal()).toMatchObject({ objet: "rupture", cle: "pizza-tonno", avant: { jusqu_au: null }, apres: { jusqu_au: dans3 } });

    // Le lendemain de la date, plus rien : on recule la date pour simuler le temps qui passe.
    await db.query("update plats set rupture_jour = (pg_catalog.now() at time zone 'Europe/Zurich')::date - 1 where slug = 'pizza-tonno'");
    const apres = await ligneCarte("pizza-tonno");
    expect(apres.rupture_motif).toBeNull();
    expect(apres.rupture_jusqu_au).toBeNull();
    expect((await f<{ slug: string; rupture: boolean }[]>("plats_tablette()")).find((p) => p.slug === "pizza-tonno")?.rupture).toBe(false);
  });

  it("aujourd'hui : même effet qu'une rupture de la tablette ; null la lève, la tablette aussi", async () => {
    await f("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(0), gerant]);
    expect((await ligneCarte("pizza-tonno")).rupture_motif).toBe("Épuisé pour aujourd'hui.");
    await f("planifier_rupture('pizza-tonno', null, $1)", [gerant]);
    expect((await ligneCarte("pizza-tonno")).rupture_motif).toBeNull();

    await f("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(5), gerant]);
    await f("regler_rupture('pizza-tonno', false, $1)", [service]);
    expect((await ligneCarte("pizza-tonno")).rupture_jusqu_au).toBeNull();
  });

  it("refuse une date passée ou au-delà de 60 jours, et un membre du service", async () => {
    expect(await erreur("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(-1), gerant])).toContain("date_rupture");
    expect(await erreur("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(61), gerant])).toContain("date_rupture");
    expect(await f("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(60), gerant])).toBe(true);
    expect(await erreur("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(2), service])).toContain("Réservé au gérant");
    expect(await f("planifier_rupture('plat-inconnu', null, $1)", [gerant])).toBe(false);
  });

  it("une option épuisée jusqu'à une date l'est pour le site et la tablette jusque-là", async () => {
    const dans2 = await jour(2);
    expect(await f("planifier_rupture_option('supplements-pizza', 'Anchois', $1::date, $2)", [dans2, gerant])).toBe(true);
    const o = await optionPublique("Anchois");
    expect(o.rupture).toBe(true);
    expect(texte(o.rupture_jusqu_au)).toBe(dans2);
    const t = await f<{ nom: string; rupture: boolean; rupture_jusqu_au: string }[]>("options_tablette()");
    expect(t.find((x) => x.nom === "Anchois")).toMatchObject({ rupture: true, rupture_jusqu_au: dans2 });
    expect(await dernierJournal()).toMatchObject({ objet: "rupture_option", cle: "supplements-pizza/Anchois" });

    await db.query("update options set rupture_jour = (pg_catalog.now() at time zone 'Europe/Zurich')::date - 1 where nom = 'Anchois'");
    expect((await optionPublique("Anchois")).rupture).toBe(false);
    expect(await f("planifier_rupture_option('supplements-pizza', 'Inconnue', null, $1)", [gerant])).toBe(false);
    expect(await erreur("planifier_rupture_option('supplements-pizza', 'Anchois', $1::date, $2)", [dans2, service])).toContain("Réservé au gérant");
  });

  it("ces écritures ne s'annulent pas depuis le journal (objets à part)", async () => {
    await f("planifier_rupture('pizza-tonno', $1::date, $2)", [await jour(2), gerant]);
    const id = (await db.query<{ id: number }>("select id from journal_gestion order by id desc limit 1")).rows[0].id;
    expect(await erreur("annuler_journal($1, $2)", [id, gerant])).toContain("non_annulable");
  });

  it("un visiteur n'appelle aucune des fonctions neuves", async () => {
    for (const fn of ["regler_disponibilite(text, jsonb, uuid)", "planifier_rupture(text, date, uuid)", "planifier_rupture_option(text, text, date, uuid)"]) {
      expect(await f("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
      expect(await f("has_function_privilege('authenticated', $1, 'execute')", [fn])).toBe(false);
    }
  });
});
