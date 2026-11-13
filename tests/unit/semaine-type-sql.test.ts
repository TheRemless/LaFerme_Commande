import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Jours fermés chaque semaine (vague 3, bo-operations) : fermer_service_semaine, ouvrir_service_semaine,
// commandes_jour_semaine. Migration 20261213120000_semaine_type.sql.

let db: PGlite;
let gerant: string;
let service: string;
const HEURES = { premiere_heure: "18:45", derniere_heure: "22:00", derniere_commande: "21:15", derniere_commande_pizzas: "21:30" };
const existe = async (jour: number, s: string) => (await db.query("select 1 from horaires where jour = $1 and service = $2", [jour, s])).rows.length === 1;

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
    insert into horloge_test values ('2026-11-16T09:00:00Z');
  `);
  gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('st-gerant@laferme.test', 'St gérant', 'gerant') returning id")).rows[0].id;
  service = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('st-service@laferme.test', 'St service', 'service') returning id")).rows[0].id;
}, 120_000);

describe("semaine type", () => {
  it("fermer le mercredi midi chaque semaine : la ligne part, le journal garde ses heures ; deux fois : faux", async () => {
    expect(await existe(3, "midi")).toBe(true);
    const r = await db.query<{ ok: boolean }>("select fermer_service_semaine(3::smallint, 'midi', $1) as ok", [gerant]);
    expect(r.rows[0].ok).toBe(true);
    expect(await existe(3, "midi")).toBe(false);
    const j = await db.query<{ cle: string; avant: { premiere_heure: string } }>("select cle, avant from journal_gestion where objet = 'horaire_semaine' order by id desc limit 1");
    expect(j.rows[0].cle).toBe("3-midi");
    expect(j.rows[0].avant.premiere_heure).toMatch(/^\d{2}:\d{2}/);
    expect((await db.query<{ ok: boolean }>("select fermer_service_semaine(3::smallint, 'midi', $1) as ok", [gerant])).rows[0].ok).toBe(false);
  });

  it("ouvrir le dimanche soir avec ses heures ; déjà ouvert : refusé ; heures incohérentes : refusées", async () => {
    expect(await existe(7, "soir")).toBe(false);
    await db.query("select ouvrir_service_semaine(7::smallint, 'soir', $1, $2)", [HEURES, gerant]);
    const h = await db.query<{ premiere_heure: string; proposition: boolean }>("select premiere_heure::text, proposition from horaires where jour = 7 and service = 'soir'");
    expect(h.rows[0]).toEqual({ premiere_heure: "18:45:00", proposition: false });
    await expect(db.query("select ouvrir_service_semaine(7::smallint, 'soir', $1, $2)", [HEURES, gerant])).rejects.toThrow(/déjà ouvert/);
    await expect(db.query("select ouvrir_service_semaine(1::smallint, 'soir', $1, $2)", [{ ...HEURES, premiere_heure: "23:00" }, gerant])).rejects.toThrow();
    await expect(db.query("select ouvrir_service_semaine(8::smallint, 'soir', $1, $2)", [HEURES, gerant])).rejects.toThrow(/inconnu/);
  });

  it("gérant seulement, fonctions réservées au serveur", async () => {
    await expect(db.query("select fermer_service_semaine(2::smallint, 'soir', $1)", [service])).rejects.toThrow();
    expect(await existe(2, "soir")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ a: boolean; b: boolean; c: boolean }>(
        `select has_function_privilege($1, 'fermer_service_semaine(smallint, text, uuid)', 'execute') as a,
                has_function_privilege($1, 'ouvrir_service_semaine(smallint, text, jsonb, uuid)', 'execute') as b,
                has_function_privilege($1, 'commandes_jour_semaine(smallint, text)', 'execute') as c`,
        [role],
      );
      expect(r.rows[0]).toEqual({ a: false, b: false, c: false });
    }
  });

  it("commandes déjà prises pour ce jour de la semaine et ce service, à venir, pas terminées", async () => {
    const p = (n: number) => ({
      jeton_suivi: `jeton-st-${n}`,
      cle_idempotence: `st-${n}`,
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir",
      zone_numero: null,
      client_prenom: `St${n}`,
      client_nom: "Test",
      client_telephone: "079 000 00 00",
      client_email: "st@laferme.test",
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: 1500,
      frais_centimes: 0,
      total_centimes: 1500,
      tva_centimes: 38,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
    });
    const cree = async (n: number, date: string, minutes: number, statut: string) => {
      const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p(n)])).rows[0].id;
      await db.query("update commandes set quand_type = 'creneau', quand_date = $2, quand_minutes = $3, statut = $4 where id = $1", [id, date, minutes, statut]);
    };
    // Lundi 16 novembre 2026. Vendredis à venir : 20 et 27 novembre.
    await cree(1, "2026-11-20", 19 * 60, "acceptee");
    await cree(2, "2026-11-27", 20 * 60, "nouvelle");
    await cree(3, "2026-11-20", 12 * 60, "acceptee"); // midi
    await cree(4, "2026-11-13", 19 * 60, "acceptee"); // passé
    await cree(5, "2026-11-20", 19 * 60, "refusee");
    const n = await db.query<{ n: number }>("select commandes_jour_semaine(5::smallint, 'soir') as n");
    expect(n.rows[0].n).toBe(2);
  });
});
