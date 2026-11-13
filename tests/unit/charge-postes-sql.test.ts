import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Heure promise réaliste, version 3 (vague 3, bo-operations) : charge_cuisine() ne compte plus les articles d'un
// poste qui a fini sa part (commande_postes.pret_le, session tablette). Migration 20261130220000_charge_postes.sql.

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
    jeton_suivi: `jeton-hp-${n}`,
    cle_idempotence: `hp-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `H${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "hp@laferme.test",
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

const pret = (id: string, station: "pizza" | "cuisine") =>
  db.query("insert into commande_postes (commande_id, station, a_faire_le, pret_le, pret_par) values ($1, $2, now(), now(), 'test')", [id, station]);

describe("charge_cuisine, postes prêts (version 3)", () => {
  it("les pizzas sorties ne comptent plus dans la file du four, la cuisine garde ses plats", async () => {
    const id = await commande({ pizzas: 12, plats: 3 });
    await commande({ pizzas: 10 });
    expect((await charge()).pizza.articles).toBe(22);
    await pret(id, "pizza");
    const c = await charge();
    expect(c.pizza.articles).toBe(10);
    expect(c.cuisine.articles).toBe(3);
    // 10 pizzas à 8 par quart d'heure : 19 min, sous la préparation habituelle, plus d'allongement.
    expect(c.allongement_minutes).toBe(0);
  });

  it("un poste ouvert (pas encore prêt) compte toujours", async () => {
    const id = await commande({ pizzas: 12, plats: 3 });
    await db.query("insert into commande_postes (commande_id, station, a_faire_le) values ($1, 'pizza', now())", [id]);
    expect((await charge()).pizza.articles).toBe(12);
  });

  it("sans la table commande_postes (migration de tablette pas encore passée) : calcul de la version 1", async () => {
    const id = await commande({ pizzas: 12, plats: 3 });
    await pret(id, "pizza");
    await db.exec("alter table commande_postes rename to commande_postes_ailleurs");
    try {
      expect((await charge()).pizza.articles).toBe(12);
    } finally {
      await db.exec("alter table commande_postes_ailleurs rename to commande_postes");
    }
  });

  it("réservée au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'charge_cuisine()', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
