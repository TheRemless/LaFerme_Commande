import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { lireCharge, raisonCharge } from "@/lib/heure-reelle";

// Heure promise réaliste avec les chiffres de Jérémy (13.11.2026) : « 5 pizzas au four, environ 3 minutes de
// préparation et 2 de cuisson », soit 15 pizzas par quart d'heure. Cuisine et livreurs sans chiffre : à 0, ignorés,
// jamais bloquants. Réglage à poser : debit_pizza_quart_heure = 15.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
const regler = (cle: string, valeur: unknown) => db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);
const lire = async () => {
  const [c, l] = await Promise.all([
    db.query<{ r: unknown }>("select charge_cuisine() as r"),
    db.query<{ r: unknown }>("select charge_livraison() as r"),
  ]);
  return lireCharge(c.rows[0].r, l.rows[0].r)!;
};

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
    jeton_suivi: `jeton-hf-${n}`,
    cle_idempotence: `hf-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `H${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "hf@laferme.test",
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
  await regler("debit_pizza_quart_heure", 15);
  await regler("debit_cuisine_quart_heure", 0);
  await regler("livraisons_par_livreur_heure", 0);
});

describe("four à 15 pizzas par quart d'heure, cuisine et livreurs à 0", () => {
  it("file courte (15 pizzas) : 15 min de file, sous la préparation habituelle, aucun allongement", async () => {
    await commande({ pizzas: 15 });
    const c = await lire();
    expect(c.pizza).toEqual({ articles: 15, file_minutes: 15, compte: true });
    expect(c.allongement_minutes).toBe(0);
    expect(raisonCharge(c)).toBeNull();
  });

  it("vendredi chargé (30 pizzas) : 30 min de file, +10 min annoncées partout", async () => {
    await commande({ pizzas: 20 });
    await commande({ pizzas: 10, plats: 6 });
    const c = await lire();
    expect(c.pizza).toEqual({ articles: 30, file_minutes: 30, compte: true });
    // Cuisine sans débit : ses 6 plats ne comptent pas et ne bloquent rien.
    expect(c.cuisine).toEqual({ articles: 6, file_minutes: 0, compte: false });
    expect(c.allongement_minutes).toBe(10);
    // Livreurs sans débit : pas comptés, la livraison suit le four.
    expect(c.livraison?.compte).toBe(false);
    expect(c.allongement_livraison_minutes).toBe(10);
    expect(raisonCharge(c)).toBe("Four : 30 pizzas en file, 30 min. Heures annoncées +10 min.");
  });

  it("très chargé (80 pizzas) : plafonné à 45 min", async () => {
    for (let i = 0; i < 4; i++) await commande({ pizzas: 20 });
    const c = await lire();
    expect(c.pizza.file_minutes).toBe(80);
    expect(c.allongement_minutes).toBe(45);
  });
});
