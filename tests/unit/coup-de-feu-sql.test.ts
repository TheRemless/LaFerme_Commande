import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Coup de feu (vague 3, bo-operations), côté base : supabase/migrations/20261130090000_coup_de_feu.sql.
// Horloge simulée comme service-correctifs-sql.test.ts : public.now() lit l'heure du test.

let db: PGlite;
const ids: Record<string, string> = {};

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function reglage<T>(cle: string): Promise<T> {
  return (await db.query<{ v: T }>("select valeur as v from reglages where cle = $1", [cle])).rows[0].v;
}
const regler = (cle: string, valeur: unknown) => db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);
const lancer = (p: Record<string, unknown>, qui = ids.service) => f<Record<string, unknown>>("lancer_coup_de_feu($1::jsonb, $2)", [JSON.stringify(p), qui]);
const finir = (qui: string | null = ids.service) => f<{ rendus: string[]; gardes: string[] } | null>("finir_coup_de_feu($1)", [qui]);

const GESTE = { retard_minutes: 20, duree_minutes: 60, capacite_livraison: 2, capacite_retrait: 2 };

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  for (const [cle, role] of [["service", "service"], ["gerant", "gerant"], ["livreur", "livreur"], ["ancien", "service"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`cdf-${cle}@laferme.test`, `Cdf ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
  await db.query("update personnel set actif = false where id = $1", [ids.ancien]);
});

beforeEach(async () => {
  await horloge("2026-11-20T18:00:00Z");
  await db.query("update reglages set valeur = 'null'::jsonb where cle = 'coup_de_feu'");
  await regler("retard_minutes", 0);
  await regler("livraison_fermee", false);
  await regler("capacite_livraisons_par_creneau", 3);
  await regler("capacite_retraits_par_creneau", 4);
});

describe("coup de feu : lancer", () => {
  it("applique retard et capacités en un geste, garde les valeurs d'avant", async () => {
    const e = await lancer(GESTE);
    expect(await reglage("retard_minutes")).toBe(20);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(2);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(2);
    expect(await reglage("livraison_fermee")).toBe(false);
    expect(e.avant).toEqual({ retard_minutes: 0, capacite_livraisons_par_creneau: 3, capacite_retraits_par_creneau: 4 });
    expect(new Date(e.jusqua as string).toISOString()).toBe("2026-11-20T19:00:00.000Z");
  });

  it("ferme la livraison seulement si demandé", async () => {
    await lancer({ duree_minutes: 30, livraison_fermee: true });
    expect(await reglage("livraison_fermee")).toBe(true);
    expect(await reglage("retard_minutes")).toBe(0);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(3);
  });

  it("ne rouvre pas une livraison déjà fermée et n'adoucit rien", async () => {
    await regler("livraison_fermee", true);
    await regler("retard_minutes", 30);
    await regler("capacite_retraits_par_creneau", 1);
    await lancer(GESTE);
    expect(await reglage("livraison_fermee")).toBe(true);
    expect(await reglage("retard_minutes")).toBe(30);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(1);
  });

  it("une capacité « sans limite » (0) prend la valeur du geste", async () => {
    await regler("capacite_livraisons_par_creneau", 0);
    await lancer(GESTE);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(2);
    await finir();
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(0);
  });

  it("le gérant peut lancer ; ni un livreur, ni un membre retiré, ni personne", async () => {
    await expect(lancer(GESTE, ids.gerant)).resolves.toBeTruthy();
    await expect(lancer(GESTE, ids.livreur)).rejects.toThrow(/Réservé à l'équipe/);
    await expect(lancer(GESTE, ids.ancien)).rejects.toThrow(/Réservé à l'équipe/);
    await expect(f("lancer_coup_de_feu($1::jsonb, null)", [JSON.stringify(GESTE)])).rejects.toThrow(/Réservé à l'équipe/);
  });

  it("refuse des valeurs hors bornes ou un geste vide", async () => {
    await expect(lancer({ ...GESTE, retard_minutes: 91 })).rejects.toThrow(/Retard/);
    await expect(lancer({ ...GESTE, duree_minutes: 10 })).rejects.toThrow(/Durée/);
    await expect(lancer({ ...GESTE, duree_minutes: 361 })).rejects.toThrow(/Durée/);
    await expect(lancer({ ...GESTE, capacite_livraison: 0 })).rejects.toThrow(/Capacité/);
    await expect(lancer({ duree_minutes: 60 })).rejects.toThrow(/Rien à changer/);
    expect(await reglage("coup_de_feu")).toBeNull();
  });

  it("relancer pendant un coup de feu le remplace avec les mêmes valeurs d'avant", async () => {
    const premier = await lancer(GESTE);
    await horloge("2026-11-20T18:30:00Z");
    const second = await lancer({ retard_minutes: 30, duree_minutes: 90 });
    expect(second.debut).toBe(premier.debut);
    expect(second.avant).toEqual({ retard_minutes: 0 });
    expect(await reglage("retard_minutes")).toBe(30);
    // Le second geste ne touche plus aux capacités : elles reviennent à leur valeur d'avant.
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(3);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(4);
    await finir();
    expect(await reglage("retard_minutes")).toBe(0);
  });
});

describe("coup de feu : fin", () => {
  it("rend les valeurs d'avant et le journalise", async () => {
    await lancer({ ...GESTE, livraison_fermee: true });
    const r = await finir(ids.gerant);
    expect(r?.gardes).toEqual([]);
    expect(await reglage("retard_minutes")).toBe(0);
    expect(await reglage("livraison_fermee")).toBe(false);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(3);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(4);
    expect(await reglage("coup_de_feu")).toBeNull();
    const j = await db.query<{ personnel_nom: string; cle: string }>(
      "select personnel_nom, cle from journal_gestion where objet = 'coup_de_feu' order by id desc limit 2",
    );
    expect(j.rows).toEqual([
      { personnel_nom: "Cdf gerant", cle: "finir" },
      { personnel_nom: "Cdf service", cle: "lancer" },
    ]);
  });

  it("garde un réglage changé pendant le coup de feu", async () => {
    await lancer(GESTE);
    // Le gérant règle la capacité des livraisons à 1 en plein coup de feu : elle reste à 1.
    await regler("capacite_livraisons_par_creneau", 1);
    const r = await finir();
    expect(r?.gardes).toEqual(["capacite_livraisons_par_creneau"]);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(1);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(4);
  });

  it("finir deux fois : la seconde ne fait rien", async () => {
    await lancer(GESTE);
    expect(await finir()).not.toBeNull();
    expect(await finir()).toBeNull();
  });

  it("se termine seul à l'heure dite, pas avant", async () => {
    await lancer(GESTE);
    await horloge("2026-11-20T18:59:00Z");
    expect(await f("fin_coup_de_feu_echue()")).toBeNull();
    expect(await reglage("retard_minutes")).toBe(20);
    await horloge("2026-11-20T19:00:00Z");
    expect(await f("fin_coup_de_feu_echue()")).not.toBeNull();
    expect(await reglage("retard_minutes")).toBe(0);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(4);
    const j = await db.query<{ personnel_nom: string; personnel_id: string | null }>(
      "select personnel_nom, personnel_id from journal_gestion where objet = 'coup_de_feu' order by id desc limit 1",
    );
    expect(j.rows[0]).toEqual({ personnel_nom: "Fin automatique", personnel_id: null });
    expect(await f("fin_coup_de_feu_echue()")).toBeNull();
  });

  it("après la remise de 5h, la fin rend la capacité sans remettre l'ancien retard", async () => {
    await horloge("2026-11-20T22:30:00Z");
    await regler("retard_minutes", 10);
    await lancer({ ...GESTE, duree_minutes: 360 });
    // Remise du jour de service suivant (5h à Genève) : retard à zéro.
    await horloge("2026-11-21T04:10:00Z");
    await f("remise_du_jour()");
    expect(await reglage("retard_minutes")).toBe(0);
    await horloge("2026-11-21T04:30:00Z");
    const r = await f<{ rendus: string[]; gardes: string[] }>("fin_coup_de_feu_echue()");
    expect(r.gardes).toEqual(["retard_minutes"]);
    expect(await reglage("retard_minutes")).toBe(0);
    expect(await reglage("capacite_livraisons_par_creneau")).toBe(3);
  });
});

describe("coup de feu : état", () => {
  it("dit qui l'a lancé, sans aucun nom dans les réglages publics", async () => {
    expect((await f<{ en_cours: unknown }>("etat_coup_de_feu()")).en_cours).toBeNull();
    await lancer(GESTE);
    const e = await f<{ en_cours: { par: string; applique: Record<string, unknown> }; defaut: Record<string, unknown>; defaut_propose: boolean; actuel: Record<string, unknown> }>(
      "etat_coup_de_feu()",
    );
    expect(e.en_cours.par).toBe("Cdf service");
    expect(e.en_cours.applique).toEqual({ retard_minutes: 20, capacite_livraisons_par_creneau: 2, capacite_retraits_par_creneau: 2 });
    expect(e.defaut).toMatchObject({ retard_minutes: 20, duree_minutes: 60 });
    expect(e.defaut_propose).toBe(true);
    expect(e.actuel.retard_minutes).toBe(20);
    expect(JSON.stringify(await reglage("coup_de_feu"))).not.toContain("Cdf");
  });

  it("les fonctions ne sont pas ouvertes aux visiteurs", async () => {
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p where p.proname in ('lancer_coup_de_feu', 'finir_coup_de_feu', 'fin_coup_de_feu_echue', 'etat_coup_de_feu', 'equipe_nom', 'coup_de_feu_rendre')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });
});
