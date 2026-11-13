import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Heure promise réaliste, version 1 (vague 3, bo-operations) : charge_cuisine(), migration
// 20261130100000_heure_reelle.sql. Horloge simulée comme service-correctifs-sql.test.ts.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const regler = (cle: string, valeur: unknown) => db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);

type Charge = {
  pizza: { articles: number; file_minutes: number; compte: boolean };
  cuisine: { articles: number; file_minutes: number; compte: boolean };
  preparation_minutes: number;
  plafond_minutes: number;
  allongement_minutes: number;
};
const charge = () => f<Charge>("charge_cuisine()");

let n = 0;
// Commande de `pizzas` pizzas et `plats` plats, au statut donné, due à `due` (heure confirmée).
async function commande(o: { pizzas: number; plats?: number; statut?: string; due?: string | null }): Promise<string> {
  n += 1;
  const ligne = (slug: string, station: string, qte: number) => ({
    slug,
    nom: slug,
    station,
    qte,
    unitaire_centimes: 1500,
    total_centimes: 1500 * qte,
    choix: {},
    retraits: [],
    note: "",
  });
  // 20 pièces au plus par ligne (contrainte commande_lignes_qte_check) : une grosse commande fait plusieurs lignes.
  const morceaux = (slug: string, station: string, total: number) =>
    Array.from({ length: Math.ceil(total / 20) }, (_, i) => ligne(slug, station, Math.min(20, total - i * 20)));
  const lignes = [...morceaux("pizza-margherita", "pizza", o.pizzas), ...morceaux("lasagne-de-boeuf", "cuisine", o.plats ?? 0)];
  const p = {
    jeton_suivi: `jeton-hr-${n}`,
    cle_idempotence: `hr-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `H${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "hr@laferme.test",
    quand_type: "asap",
    pizzas_seulement: !o.plats,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes,
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = $2, heure_confirmee = $3::timestamptz where id = $1", [id, o.statut ?? "acceptee", o.due === undefined ? "2026-11-20T18:15:00Z" : o.due]);
  return id;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
}, 120_000);

beforeEach(async () => {
  await db.exec("truncate commandes cascade");
  // Vendredi 20 novembre 2026, 19h00 à Genève (18h00 UTC).
  await horloge("2026-11-20T18:00:00Z");
  await regler("preparation_minutes", 20);
  await regler("allongement_max_minutes", 45);
  await regler("debit_pizza_quart_heure", 8);
  await regler("debit_cuisine_quart_heure", 10);
});

describe("charge_cuisine", () => {
  it("débits à zéro (valeur de départ) : la file n'allonge rien", async () => {
    await regler("debit_pizza_quart_heure", 0);
    await regler("debit_cuisine_quart_heure", 0);
    await commande({ pizzas: 20, plats: 20 });
    const c = await charge();
    expect(c.pizza).toEqual({ articles: 20, file_minutes: 0, compte: false });
    expect(c.allongement_minutes).toBe(0);
  });

  it("vendredi soir : 22 pizzas en file, 8 par quart d'heure → 42 min de file, +25 min annoncées", async () => {
    await commande({ pizzas: 10 });
    await commande({ pizzas: 12, plats: 3 });
    const c = await charge();
    expect(c.pizza).toEqual({ articles: 22, file_minutes: 42, compte: true });
    expect(c.cuisine).toEqual({ articles: 3, file_minutes: 5, compte: true });
    // 42 - 20 de préparation = 22, arrondi aux 5 minutes au-dessus.
    expect(c.allongement_minutes).toBe(25);
  });

  it("file courte : rien de plus que le délai habituel", async () => {
    await commande({ pizzas: 8 });
    const c = await charge();
    expect(c.pizza.file_minutes).toBe(15);
    expect(c.allongement_minutes).toBe(0);
  });

  it("plafonné par allongement_max_minutes", async () => {
    await commande({ pizzas: 60 });
    await regler("allongement_max_minutes", 30);
    expect((await charge()).allongement_minutes).toBe(30);
  });

  it("ne compte que les commandes pas prêtes, dues bientôt et pas oubliées", async () => {
    await commande({ pizzas: 5, statut: "nouvelle", due: null });
    await commande({ pizzas: 4, statut: "en_preparation" });
    await commande({ pizzas: 50, statut: "prete" });
    await commande({ pizzas: 50, statut: "partie" });
    await commande({ pizzas: 50, statut: "refusee" });
    // Pour 21h (après préparation + allongement maximal) : pas encore devant une commande passée maintenant.
    await commande({ pizzas: 50, due: "2026-11-20T20:00:00Z" });
    // Due il y a deux heures, jamais marquée prête : oubliée sur la tablette.
    await commande({ pizzas: 50, due: "2026-11-20T16:00:00Z" });
    expect((await charge()).pizza.articles).toBe(9);
  });

  it("une commande pour un créneau pas encore confirmée compte à l'heure de son créneau", async () => {
    const id = await commande({ pizzas: 7, statut: "nouvelle", due: null });
    // 19h30 à Genève : dans la fenêtre.
    await db.query("update commandes set quand_type = 'creneau', quand_date = '2026-11-20', quand_minutes = 1170 where id = $1", [id]);
    expect((await charge()).pizza.articles).toBe(7);
    // 22h30 : hors de la fenêtre.
    await db.query("update commandes set quand_minutes = 1350 where id = $1", [id]);
    expect((await charge()).pizza.articles).toBe(0);
  });

  it("aucune donnée de client, fonction fermée aux visiteurs", async () => {
    await commande({ pizzas: 3 });
    expect(JSON.stringify(await charge())).not.toMatch(/H\d|hr@|079/);
    const r = await db.query<{ ok: boolean }>(
      "select has_function_privilege('anon', 'charge_cuisine()', 'execute') or has_function_privilege('authenticated', 'charge_cuisine()', 'execute') as ok",
    );
    expect(r.rows[0].ok).toBe(false);
  });
});
