import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Planning et suivi des livreurs, côté base : migration 20261130120000_planning_livreurs.sql.
// Horloge simulée : vendredi 20 novembre 2026, 17h à Genève.

let db: PGlite;
const ids: Record<string, string> = {};

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
type Jour = { jour: string; service: string; presents: number; livreurs: { nom: string; present: boolean; source: string; motif: string | null }[] };
const planning = (debut: string, fin: string) => f<Jour[]>("planning_livreurs($1::date, $2::date)", [debut, fin]);
const semaine = (livreur: string, creneaux: { jour: number; service: string }[], qui = ids.gerant) =>
  f<unknown>("regler_semaine_livreur($1, $2::jsonb, $3)", [livreur, JSON.stringify(creneaux), qui]);
const jour = (livreur: string, j: string, service: string, present: boolean | null, motif: string | null = null, qui = ids.service) =>
  f<boolean>("regler_jour_livreur($1, $2::date, $3, $4, $5, $6)", [livreur, j, service, present, motif, qui]);

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
    update personnel set actif = false where role = 'livreur';
  `);
  for (const [cle, nom, role] of [
    ["gerant", "Pl gérant", "gerant"],
    ["service", "Pl service", "service"],
    ["marco", "Pl Marco", "livreur"],
    ["ines", "Pl Inès", "livreur"],
    ["ancien", "Pl Ancien", "livreur"],
  ] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`pl-${cle}@laferme.test`, nom, role]);
    ids[cle] = r.rows[0].id;
  }
});

beforeEach(async () => {
  await horloge("2026-11-20T16:00:00Z");
  await db.exec("delete from livreurs_semaine where true; delete from livreurs_jours where true;");
  await db.query("update personnel set actif = true where id = $1", [ids.ancien]);
});

describe("semaine type et jour", () => {
  it("qui travaille ce soir : semaine type, renfort, absence", async () => {
    // Marco du mardi au samedi soir, Inès vendredi et samedi soir.
    await semaine(ids.marco, [2, 3, 4, 5, 6].map((j) => ({ jour: j, service: "soir" })));
    await semaine(ids.ines, [5, 6].map((j) => ({ jour: j, service: "soir" })));
    let ce = (await planning("2026-11-20", "2026-11-20")).find((x) => x.service === "soir")!;
    expect(ce.presents).toBe(2);
    // Marco appelle à 18h : malade. Inès vient aussi samedi midi.
    expect(await jour(ids.marco, "2026-11-20", "soir", false, "Malade")).toBe(true);
    await jour(ids.ines, "2026-11-21", "midi", true);
    const p = await planning("2026-11-20", "2026-11-21");
    ce = p.find((x) => x.jour === "2026-11-20" && x.service === "soir")!;
    expect(ce.presents).toBe(1);
    expect(ce.livreurs).toEqual([
      { id: ids.ines, nom: "Pl Inès", present: true, source: "semaine", motif: null },
      { id: ids.marco, nom: "Pl Marco", present: false, source: "absent", motif: "Malade" },
    ]);
    const samediMidi = p.find((x) => x.jour === "2026-11-21" && x.service === "midi")!;
    expect(samediMidi.livreurs).toEqual([{ id: ids.ines, nom: "Pl Inès", present: true, source: "ajout", motif: null }]);
    // Retour à la semaine type.
    await jour(ids.marco, "2026-11-20", "soir", null);
    expect((await planning("2026-11-20", "2026-11-20")).find((x) => x.service === "soir")!.presents).toBe(2);
  });

  it("semaine type relue pour l'écran, livreurs actifs seulement", async () => {
    await semaine(ids.marco, [{ jour: 6, service: "soir" }, { jour: 5, service: "soir" }, { jour: 5, service: "soir" }]);
    const s = await f<{ id: string; nom: string; creneaux: unknown[] }[]>("semaines_livreurs()");
    expect(s.find((x) => x.id === ids.marco)?.creneaux).toEqual([{ jour: 5, service: "soir" }, { jour: 6, service: "soir" }]);
    expect(s.find((x) => x.id === ids.ines)?.creneaux).toEqual([]);
    await db.query("update personnel set actif = false where id = $1", [ids.ancien]);
    expect(s.length - (await f<unknown[]>("semaines_livreurs()")).length).toBe(1);
  });

  it("journalisé avec le prénom du livreur", async () => {
    await semaine(ids.marco, [{ jour: 5, service: "soir" }]);
    await jour(ids.marco, "2026-11-20", "soir", false, "Malade");
    const j = await db.query<{ objet: string; cle: string; personnel_nom: string; apres: unknown }>(
      "select objet, cle, personnel_nom, apres from journal_gestion where objet like 'livreur_%' order by id desc limit 2",
    );
    expect(j.rows).toEqual([
      { objet: "livreur_jour", cle: "Pl Marco", personnel_nom: "Pl service", apres: { jour: "2026-11-20", service: "soir", present: false, motif: "Malade" } },
      { objet: "livreur_semaine", cle: "Pl Marco", personnel_nom: "Pl gérant", apres: [{ jour: 5, service: "soir" }] },
    ]);
  });

  it("un livreur retiré disparaît du planning et ne se planifie plus", async () => {
    await semaine(ids.ancien, [{ jour: 5, service: "soir" }]);
    await db.query("update personnel set actif = false where id = $1", [ids.ancien]);
    expect(await planning("2026-11-20", "2026-11-20")).toEqual([]);
    await expect(semaine(ids.ancien, [{ jour: 5, service: "soir" }])).rejects.toThrow(/retiré/);
    await expect(jour(ids.ancien, "2026-11-20", "soir", true)).rejects.toThrow(/retiré/);
    await expect(semaine(ids.service, [{ jour: 5, service: "soir" }])).rejects.toThrow(/Livreur inconnu/);
  });

  it("droits : semaine type au gérant, jour à l'équipe, rien au livreur", async () => {
    await expect(semaine(ids.marco, [{ jour: 5, service: "soir" }], ids.service)).rejects.toThrow(/gérant/);
    await expect(jour(ids.marco, "2026-11-20", "soir", false, null, ids.marco)).rejects.toThrow(/équipe/);
    expect(await jour(ids.marco, "2026-11-20", "soir", false, null, ids.gerant)).toBe(true);
  });

  it("refuse les valeurs hors bornes", async () => {
    await expect(semaine(ids.marco, [{ jour: 8, service: "soir" }])).rejects.toThrow(/jours de 1 à 7/);
    await expect(semaine(ids.marco, [{ jour: 5, service: "nuit" }])).rejects.toThrow(/midi ou soir/);
    await expect(jour(ids.marco, "2026-11-19", "soir", false)).rejects.toThrow(/aujourd'hui/);
    await expect(jour(ids.marco, "2027-01-30", "soir", false)).rejects.toThrow(/60 jours/);
    await expect(jour(ids.marco, "2026-11-20", "nuit", false)).rejects.toThrow(/Service/);
    await expect(jour(ids.marco, "2026-11-20", "soir", false, "x")).rejects.toThrow(/Motif/);
  });
});

describe("statistiques", () => {
  it("compte, temps moyen et retard, sans les réattribuées", async () => {
    await db.exec("truncate commandes cascade");
    const p = {
      jeton_suivi: "jeton-pl",
      cle_idempotence: "pl",
      mode: "livraison",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      zone_numero: 1,
      client_prenom: "Pl",
      client_nom: "Test",
      client_telephone: "079 000 00 00",
      client_email: "pl@laferme.test",
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: 3000,
      frais_centimes: 0,
      total_centimes: 3000,
      tva_centimes: 76,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
    };
    const commande = async (n: number) => (await db.query<{ id: string }>("select id from creer_commande($1)", [{ ...p, jeton_suivi: `jeton-pl-${n}`, cle_idempotence: `pl-${n}` }])).rows[0].id;
    const a = await commande(1);
    const b = await commande(2);
    const c = await commande(3);
    // a : livrée par Marco en 20 min, 10 min après l'heure promise. b : client absent. c : donnée à Inès puis à Marco.
    await db.query("update commandes set statut = 'terminee', heure_confirmee = '2026-11-20T18:30:00Z' where id = $1", [a]);
    await db.query(
      `insert into evenements_commande (commande_id, de, vers, par, le) values
        ($1, 'prete', 'partie', 'livreur:Pl Marco', '2026-11-20T18:20:00Z'), ($1, 'partie', 'terminee', 'livreur:Pl Marco', '2026-11-20T18:40:00Z')`,
      [a],
    );
    await db.query("update commandes set statut = 'terminee' where id = $1", [b]);
    await db.query(
      `insert into livraisons (commande_id, livreur_id, attribuee_par, attribuee_le, retiree_le, raison_retrait, probleme) values
        ($1, $4, 'test', '2026-11-20T18:00:00Z', null, null, null),
        ($2, $4, 'test', '2026-11-20T18:05:00Z', '2026-11-20T18:50:00Z', 'client_absent', 'client_absent'),
        ($3, $5, 'test', '2026-11-20T18:06:00Z', '2026-11-20T18:10:00Z', 'reattribuee', null),
        ($3, $4, 'test', '2026-11-20T18:10:00Z', null, null, null)`,
      [a, b, c, ids.marco, ids.ines],
    );
    const s = await f<Record<string, unknown>[]>("stats_livreurs('2026-11-20', '2026-11-20')");
    expect(s).toEqual([
      {
        livreur_id: ids.marco,
        nom: "Pl Marco",
        actif: true,
        livraisons: 3,
        livrees: 1,
        client_absent: 1,
        problemes: 1,
        minutes_moyennes: 20,
        retard_moyen_minutes: 10,
      },
    ]);
    expect(await f("stats_livreurs('2026-11-21', '2026-11-22')")).toEqual([]);
  });

  it("les fonctions ne sont pas ouvertes aux visiteurs", async () => {
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p where p.proname in ('livreur_actif', 'regler_semaine_livreur', 'regler_jour_livreur', 'planning_livreurs', 'stats_livreurs', 'semaines_livreurs')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });
});
