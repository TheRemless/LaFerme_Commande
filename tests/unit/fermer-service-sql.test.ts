import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Fermer le service du jour (vague 3, bo-operations ; droit fermer_service du responsable de service, D1).
// Migration 20261213130000_fermer_service_du_jour.sql. Horloge simulée : vendredi 20 novembre 2026, 17h à Genève.

let db: PGlite;
const ids: Record<string, string> = {};
const fermer = (quoi: string, motif: string, qui: string) => db.query<{ id: number }>("select fermer_service_du_jour($1, $2, $3) as id", [quoi, motif, ids[qui]]);
const fermeturesDuJour = async () =>
  (await db.query<{ service: string | null; motif: string }>("select service, motif from fermetures where debut = '2026-11-20' and fin = '2026-11-20' order by id")).rows;
const roleActif = (actif: boolean) =>
  db.query("insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', $1::jsonb, false) on conflict (cle) do update set valeur = excluded.valeur", [JSON.stringify(actif)]);

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
    insert into horloge_test values ('2026-11-20T16:00:00Z');
  `);
  await roleActif(true);
  for (const [cle, role] of [["gerant", "gerant"], ["responsable", "responsable"], ["service", "service"], ["livreur", "livreur"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`fs-${cle}@laferme.test`, `Fs ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
}, 120_000);

beforeEach(async () => {
  await db.exec("delete from fermetures where debut = '2026-11-20' and fin = '2026-11-20'");
  await roleActif(true);
});

describe("fermer_service_du_jour", () => {
  it("le responsable ferme ce soir, aujourd'hui seulement ; deux fois : refusé ; puis toute la journée", async () => {
    await fermer("soir", "Panne du four", "responsable");
    expect(await fermeturesDuJour()).toEqual([{ service: "soir", motif: "Panne du four" }]);
    await expect(fermer("soir", "Encore", "responsable")).rejects.toThrow(/deja_ferme/);
    await fermer("journee", "Panne électrique", "responsable");
    expect((await fermeturesDuJour()).map((f) => f.service)).toEqual(["soir", null]);
    await expect(fermer("midi", "Après la journée", "responsable")).rejects.toThrow(/deja_ferme/);
    await expect(fermer("journee", "Après la journée", "responsable")).rejects.toThrow(/deja_ferme/);
    const j = await db.query<{ personnel_nom: string }>("select personnel_nom from journal_gestion where objet = 'fermeture' order by id desc limit 1");
    expect(j.rows[0].personnel_nom).toBe("Fs responsable");
  });

  it("le gérant aussi ; l'équipe de service, le livreur et un responsable sans le rôle activé : refusés", async () => {
    await fermer("midi", "Coup dur", "gerant");
    await expect(fermer("soir", "Panne", "service")).rejects.toThrow(/droit_refuse/);
    await expect(fermer("soir", "Panne", "livreur")).rejects.toThrow(/droit_refuse/);
    await roleActif(false);
    await expect(fermer("soir", "Panne", "responsable")).rejects.toThrow(/droit_refuse/);
  });

  it("motif et service contrôlés", async () => {
    await expect(fermer("soir", " ", "responsable")).rejects.toThrow(/motif_invalide/);
    await expect(fermer("demain", "Panne", "responsable")).rejects.toThrow(/service_invalide/);
  });

  it("le responsable reste refusé pour une autre date, les horaires et les zones (fonctions du gérant)", async () => {
    await expect(db.query("select ajouter_fermeture_service('2026-11-21', 'soir', 'Panne', $1)", [ids.responsable])).rejects.toThrow();
    await expect(db.query("select ajouter_fermeture('2026-11-21', '2026-11-22', 'Vacances', $1)", [ids.responsable])).rejects.toThrow();
    const h = (await db.query<{ id: number }>("select id from horaires order by id limit 1")).rows[0].id;
    await expect(db.query("select modifier_horaire($1::smallint, '{\"premiere_heure\": \"18:00\"}'::jsonb, $2)", [h, ids.responsable])).rejects.toThrow();
    await expect(db.query("select modifier_zone(1::smallint, '{\"frais_centimes\": 100}'::jsonb, $1)", [ids.responsable])).rejects.toThrow();
  });

  it("réservée au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'fermer_service_du_jour(text, text, uuid)', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
