import type { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Impression des commandes à l'avance (audit « samedi soir » SS-11, audit du gérant G08 option A), côté base,
// avec l'horloge simulée de service-correctifs-sql.test.ts. Une commande acceptée n'a ses tickets qu'à
// partir de l'heure promise moins le réglage impression_avance_minutes ; premiers_tickets ne les crée
// qu'une fois, quel que soit le nombre de tours de surveillance ou de serveurs.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

let n = 0;
async function acceptee(heure: string, extra: Record<string, unknown> = {}): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-av-${n}`,
    cle_idempotence: `av-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: `A${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "av@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      {
        slug: "pizza-margherita",
        nom: "Pizza Margherita",
        station: "pizza",
        qte: 1,
        unitaire_centimes: 1500,
        total_centimes: 1500,
        choix: {},
        retraits: [],
        note: "",
      },
      {
        slug: "lasagne-de-boeuf",
        nom: "Lasagne de bœuf",
        station: "cuisine",
        qte: 1,
        unitaire_centimes: 1500,
        total_centimes: 1500,
        choix: {},
        retraits: [],
        note: "",
      },
    ],
    ...extra,
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  expect(await f<boolean>("changer_statut($1, 'acceptee', 'tablette:Test', $2)", [id, heure])).toBe(true);
  return id;
}
const aImprimer = () => f<string[]>("commandes_a_imprimer()");
const TICKETS = [
  { station: "pizza", contenu: [{ t: "texte", texte: "PIZZA" }] },
  { station: "cuisine", contenu: [{ t: "texte", texte: "CUISINE" }] },
];
const premiers = (id: string) => f<number>("premiers_tickets($1, $2)", [id, JSON.stringify(TICKETS)]);
const taches = async (id: string) =>
  (
    await db.query<{ station: string; etat: string; reimpression: boolean }>(
      "select station, etat, reimpression from taches_impression where commande_id = $1 order by station::text",
      [id],
    )
  ).rows;

// Une seule base (la recréer à chaque test dépasse le délai des hooks sur une machine chargée), vidée entre les tests.
beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ('P', 'pizza', 'h-p', '00:11:62:00:00:01'), ('C', 'cuisine', 'h-c', '00:11:62:00:00:02')");
}, 120_000);
beforeEach(async () => {
  await db.exec(`
    truncate commandes cascade;
    delete from horloge_test where true;
    update reglages set valeur = '60', proposition = true where cle = 'impression_avance_minutes';
    update reglages set valeur = 'null' where cle = 'pause_jusqu_a';
    update imprimantes set actif = true where not actif;
  `);
});

describe("Réglage impression_avance_minutes", () => {
  it("vaut 60 minutes au départ, marqué comme proposition", async () => {
    const r = (await db.query<{ valeur: number; proposition: boolean }>("select valeur, proposition from reglages where cle = 'impression_avance_minutes'")).rows[0];
    expect(r).toEqual({ valeur: 60, proposition: true });
  });

  it("se règle par le gérant seulement, de 15 à 240 minutes, et s'inscrit au journal", async () => {
    const gerant = (await db.query<{ id: string }>("select id from personnel where role = 'gerant' and actif limit 1")).rows[0].id;
    await f("regler_impression_avance(90, $1)", [gerant]);
    expect((await db.query<{ valeur: number; proposition: boolean }>("select valeur, proposition from reglages where cle = 'impression_avance_minutes'")).rows[0]).toEqual({
      valeur: 90,
      proposition: false,
    });
    expect((await db.query("select 1 from journal_gestion where cle = 'impression_avance_minutes'")).rows).toHaveLength(1);
    await expect(f("regler_impression_avance(10, $1)", [gerant])).rejects.toThrow();
    await expect(f("regler_impression_avance(241, $1)", [gerant])).rejects.toThrow();
    const service = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('svc-av@laferme.test', 'Svc', 'service') returning id")).rows[0].id;
    await expect(f("regler_impression_avance(30, $1)", [service])).rejects.toThrow();
  });
});

describe("Moment de l'impression", () => {
  it("commande acceptée la veille pour 19h30 : rien avant 18h30 le jour même, puis à imprimer", async () => {
    await horloge("2026-11-13T17:00:00Z"); // vendredi 18h, Genève
    const id = await acceptee("2026-11-14T18:30:00Z"); // samedi 19h30, Genève
    expect(await aImprimer()).toEqual([]);
    await horloge("2026-11-14T17:29:00Z");
    expect(await aImprimer()).toEqual([]);
    await horloge("2026-11-14T17:30:00Z");
    expect(await aImprimer()).toEqual([id]);
  });

  it("service du midi et du soir : chaque commande sort une heure avant son heure, dans l'ordre", async () => {
    await horloge("2026-11-14T08:00:00Z"); // samedi 9h
    const soir = await acceptee("2026-11-14T18:00:00Z"); // 19h
    const midi = await acceptee("2026-11-14T11:15:00Z"); // 12h15
    await horloge("2026-11-14T10:20:00Z");
    expect(await aImprimer()).toEqual([midi]);
    await premiers(midi);
    expect(await aImprimer()).toEqual([]);
    await horloge("2026-11-14T17:05:00Z");
    expect(await aImprimer()).toEqual([soir]);
  });

  it("commande pour bientôt (dès que possible) : à imprimer tout de suite", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const id = await acceptee("2026-11-14T18:25:00Z");
    expect(await aImprimer()).toEqual([id]);
  });

  it("le délai suit le réglage", async () => {
    await horloge("2026-11-14T16:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    await db.query("update reglages set valeur = '180' where cle = 'impression_avance_minutes'");
    expect(await aImprimer()).toEqual([id]);
  });

  it("changement d'heure après acceptation : l'impression suit la nouvelle heure", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    expect(await f<boolean>("changer_heure($1, $2, 'tablette:Test')", [id, "2026-11-14T19:30:00Z"])).toBe(true);
    await horloge("2026-11-14T17:45:00Z");
    expect(await aImprimer()).toEqual([]);
    await horloge("2026-11-14T18:30:00Z");
    expect(await aImprimer()).toEqual([id]);
    // Avancée : elle sort tout de suite.
    const autre = await acceptee("2026-11-14T21:00:00Z");
    expect(await f<boolean>("changer_heure($1, $2, 'tablette:Test')", [autre, "2026-11-14T19:00:00Z"])).toBe(true);
    expect(await aImprimer()).toContain(autre);
  });

  it("annulée avant l'impression : jamais imprimée, aucun ticket « ANNULÉE »", async () => {
    await horloge("2026-11-13T17:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    expect(await f<boolean>("changer_statut($1, 'refusee', 'tablette:Test', null, 'Client injoignable.')", [id])).toBe(true);
    expect(await f<string[]>("annuler_impression($1)", [id])).toEqual([]);
    await horloge("2026-11-14T18:00:00Z");
    expect(await aImprimer()).toEqual([]);
    expect(await premiers(id)).toBe(0);
    expect(await taches(id)).toEqual([]);
  });

  it("pause des commandes : les commandes déjà acceptées s'impriment quand même", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    await f("regler_service($1, null)", [{ pause_jusqu_a: "sans-fin" }]);
    await horloge("2026-11-14T17:40:00Z");
    expect(await aImprimer()).toEqual([id]);
  });

  it("prête ou partie avant l'heure prévue : plus rien à imprimer", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    expect(await f<boolean>("changer_statut($1, 'prete', 'tablette:Test')", [id])).toBe(true);
    await horloge("2026-11-14T17:40:00Z");
    expect(await aImprimer()).toEqual([]);
  });
});

describe("premiers_tickets", () => {
  it("crée les tickets une seule fois : deux tours de surveillance ou deux serveurs ne doublent rien", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    expect(await premiers(id)).toBe(2);
    expect(await premiers(id)).toBe(0);
    expect(await taches(id)).toEqual([
      { station: "cuisine", etat: "en_attente", reimpression: false },
      { station: "pizza", etat: "en_attente", reimpression: false },
    ]);
    expect(await aImprimer()).toEqual([]);
  });

  it("refuse une commande qui n'est pas acceptée", async () => {
    n += 1;
    const id = (
      await db.query<{ id: string }>("select id from creer_commande($1)", [
        {
          jeton_suivi: `jeton-av-${n}`,
          cle_idempotence: `av-${n}`,
          mode: "retrait",
          statut: "nouvelle",
          statut_paiement: "a_encaisser_retrait",
          moyen_paiement: "comptoir",
          client_prenom: "N",
          client_nom: "Test",
          client_telephone: "079 000 00 00",
          client_email: "av@laferme.test",
          quand_type: "asap",
          pizzas_seulement: false,
          sous_total_centimes: 1500,
          frais_centimes: 0,
          total_centimes: 1500,
          tva_centimes: 38,
          taux_tva_pourcent: 2.6,
          origine: "http://localhost:3000",
          lignes: [
            {
              slug: "pizza-margherita",
              nom: "Pizza Margherita",
              station: "pizza",
              qte: 1,
              unitaire_centimes: 1500,
              total_centimes: 1500,
              choix: {},
              retraits: [],
              note: "",
            },
          ],
        },
      ])
    ).rows[0].id;
    expect(await premiers(id)).toBe(0);
  });

  it("imprimante hors ligne au moment prévu : le ticket attend dans sa file et sort à son retour", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    await premiers(id);
    // L'imprimante revient vingt minutes plus tard : son passage lui donne le ticket.
    await horloge("2026-11-14T18:20:00Z");
    const passage = await f<{ tache: string | null }>("passage_imprimante('h-p', '00:11:62:00:00:01', '200 OK')");
    expect(passage.tache).not.toBeNull();
  });

  it("aucune imprimante active au moment prévu : « pas d'imprimante », repris à la réactivation", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    await db.query("update imprimantes set actif = false where station = 'pizza'");
    await premiers(id);
    expect((await taches(id)).find((t) => t.station === "pizza")?.etat).toBe("sans_imprimante");
    const p = (await db.query<{ id: number }>("select id from imprimantes where station = 'pizza'")).rows[0].id;
    await db.query("update imprimantes set actif = true where id = $1", [p]);
    await f("reprendre_sans_imprimante($1)", [p]);
    expect((await taches(id)).find((t) => t.station === "pizza")?.etat).toBe("en_attente");
  });

  it("les commandes acceptées avant la migration comptent comme imprimées", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const id = await acceptee("2026-11-14T18:30:00Z");
    await db.query("update commandes set tickets_le = null where id = $1", [id]);
    // L'instruction de la migration, rejouée telle quelle : aucun ticket ne ressort pour une commande déjà acceptée.
    const fichier = readdirSync("supabase/migrations").find((f) => f.endsWith("_impression_a_lavance.sql"));
    const migration = readFileSync(`supabase/migrations/${fichier}`, "utf8");
    const remplissage = migration.split("\n").find((l) => l.startsWith("update commandes set tickets_le"));
    expect(remplissage).toBeDefined();
    await db.exec(remplissage!);
    await horloge("2026-11-14T18:00:00Z");
    expect(await aImprimer()).toEqual([]);
  });
});
