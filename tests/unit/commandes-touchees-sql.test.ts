import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Commandes touchées par une rupture (migration commandes_touchees). Montants d'essai posés par le test :
// aucun prix de la carte.

let db: PGlite;
let n = 0;
let aujourdhui: string;
let demain: string;

type Ligne = { slug: string; station: "pizza" | "cuisine" };
async function commande(lignes: Ligne[], o: { statut?: string; quand?: { date: string; minutes: number } } = {}): Promise<{ id: string; numero: number }> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-touchee-${n}`,
    cle_idempotence: `touchee-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    zone_numero: null,
    client_prenom: `Touchee${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "touchee@laferme.test",
    quand_type: o.quand ? "creneau" : "asap",
    quand_date: o.quand?.date,
    quand_minutes: o.quand?.minutes,
    pizzas_seulement: lignes.every((l) => l.station === "pizza"),
    sous_total_centimes: 100 * lignes.length,
    frais_centimes: 0,
    total_centimes: 100 * lignes.length,
    tva_centimes: 3,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: lignes.map((l) => ({ slug: l.slug, nom: l.slug, station: l.station, qte: 2, unitaire_centimes: 50, total_centimes: 100, choix: {}, retraits: [], note: "" })),
  };
  const r = (await db.query<{ id: string; numero: number }>("select id, numero from creer_commande($1)", [p])).rows[0];
  await db.query("update commandes set statut = $2 where id = $1", [r.id, o.statut ?? "acceptee"]);
  return r;
}
async function touchees(slugs: string[], cible: string | null, jusqu: string | null): Promise<{ id: string; numero: number; statut: string; lignes: { nom: string; qte: number }[]; jour: string }[]> {
  return (await db.query<{ r: never }>("select commandes_touchees($1, $2, $3) as r", [slugs, cible, jusqu])).rows[0].r;
}

const PIZZA: Ligne = { slug: "pizza-margherita", station: "pizza" };
const LASAGNE: Ligne = { slug: "lasagne-de-boeuf", station: "cuisine" };

beforeAll(async () => {
  db = await creerBaseLocale();
  const d = (await db.query<{ a: string; b: string }>("select ((now() at time zone 'Europe/Zurich')::date)::text as a, ((now() at time zone 'Europe/Zurich')::date + 1)::text as b")).rows[0];
  aujourdhui = d.a;
  demain = d.b;
});

describe("commandes_touchees", () => {
  it("un plat : seulement les commandes pas encore prêtes qui le contiennent, avec ses lignes touchées", async () => {
    const a = await commande([PIZZA, LASAGNE], { statut: "nouvelle" });
    const b = await commande([PIZZA], { statut: "en_preparation" });
    const prete = await commande([PIZZA], { statut: "prete" });
    const sans = await commande([LASAGNE]);
    const r = await touchees(["pizza-margherita"], null, null);
    const ids = r.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids).not.toContain(prete.id);
    expect(ids).not.toContain(sans.id);
    expect(r.find((c) => c.id === a.id)).toMatchObject({ statut: "nouvelle", lignes: [{ nom: "pizza-margherita", qte: 2 }] });
  });

  it("tout un poste ou toute une catégorie", async () => {
    const p = await commande([PIZZA]);
    const c = await commande([LASAGNE]);
    const poste = (await touchees([], "poste:cuisine", null)).map((x) => x.id);
    expect(poste).toContain(c.id);
    expect(poste).not.toContain(p.id);
    const categorie = (await touchees([], "categorie:pizzas", null)).map((x) => x.id);
    expect(categorie).toContain(p.id);
    expect(categorie).not.toContain(c.id);
  });

  it("une commande prévue demain compte seulement si la rupture va jusque-là", async () => {
    const plus = await commande([PIZZA], { quand: { date: demain, minutes: 19 * 60 } });
    expect((await touchees(["pizza-margherita"], null, aujourdhui)).map((x) => x.id)).not.toContain(plus.id);
    const r = await touchees(["pizza-margherita"], null, demain);
    expect(r.find((x) => x.id === plus.id)).toMatchObject({ jour: demain });
  });

  it("aucun nom ni téléphone ; un visiteur ne l'appelle pas", async () => {
    const r = await touchees(["pizza-margherita"], null, null);
    expect(r.length).toBeGreaterThan(0);
    // Le numéro entier, pas « 079 » seul : un UUID de la réponse peut contenir ces trois chiffres (CI de #249).
    expect(JSON.stringify(r)).not.toMatch(/Touchee|079 000 00 00|laferme\.test/);
    expect(r.flatMap((x) => Object.keys(x)).filter((k) => /client|nom|telephone|email/.test(k))).toEqual([]);
    expect((await db.query<{ r: boolean }>("select has_function_privilege('anon', 'commandes_touchees(text[], text, date)', 'execute') as r")).rows[0].r).toBe(false);
  });
});
