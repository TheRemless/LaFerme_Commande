import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// S2-13 (audit sécurité 2) : un manque se rembourse au prix payé pour chaque supplément, figé avec la
// commande, et plus au prix du jour. Une commande d'avant la migration (prix non figé) reste plafonnée
// par le total de sa ligne moins ce qui en a déjà été rendu.

let db: PGlite;
let service: string;
let n = 0;

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
async function prixAnanas(centimes: number) {
  await db.query(
    "update options set prix_centimes = $1 where nom = 'Ananas' and groupe_id = (select id from groupes_options where slug = 'supplements-pizza')",
    [centimes],
  );
}

type Ligne = Record<string, unknown>;
// Une ligne de pizzas Margherita avec ananas (pâte à 2100), plus une lasagne (1800) si demandé.
function pizzas(qte: number, ananas: number, fige: boolean): Ligne {
  const unitaire = 2100 + ananas;
  return {
    slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte, unitaire_centimes: unitaire, total_centimes: unitaire * qte,
    choix: { "supplements-pizza": ["Ananas"] }, retraits: [], note: "",
    ...(fige ? { prix_choix: { "supplements-pizza": { Ananas: ananas } } } : {}),
  };
}
const lasagne: Ligne = {
  slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800,
  choix: {}, retraits: [], note: "", prix_choix: {},
};

async function acceptee(lignes: Ligne[]): Promise<string> {
  n += 1;
  const total = lignes.reduce((s, l) => s + (l.total_centimes as number), 0);
  const c = (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `jeton-pf-${n}`, cle_idempotence: `pf-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
        moyen_paiement: "en_ligne", client_prenom: `P${n}`, client_nom: "Test", client_telephone: "079 000 00 00", client_email: "pf@laferme.test",
        quand_type: "asap", pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0, total_centimes: total,
        tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000", lignes,
      },
    ])
  ).rows[0];
  await f("appliquer_paiement($1, $2, 'paye', 'pi_pf', $3)", [`evt-${c.id}`, c.id, total]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  return c.id;
}
async function manque(commande: string, elements: unknown[], cle: string): Promise<number> {
  return (await f<{ montant_centimes: number }>("signaler_manque($1, $2, $3, $4, true)", [commande, elements, cle, service])).montant_centimes;
}
const ananas = { ligne: 0, groupe: "supplements-pizza", nom: "Ananas" };

beforeEach(async () => {
  db = await creerBaseLocale();
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
  // Prix du jour posé par le test, jamais lu dans le seed.
  await prixAnanas(200);
});

describe("S2-13 : prix des suppléments figé avec la commande", () => {
  it("creer_commande garde le prix payé de chaque option", async () => {
    const c = await acceptee([pizzas(4, 300, true), lasagne]);
    const lignes = (await db.query<{ prix_choix: unknown }>("select prix_choix from commande_lignes where commande_id = $1 order by position", [c])).rows;
    expect(lignes.map((l) => l.prix_choix)).toEqual([{ "supplements-pizza": { Ananas: 300 } }, {}]);
  });

  it("le cas du rapport : supplément à CHF 3 passé à CHF 8, ligne de 4 plats, CHF 12 rendus", async () => {
    await prixAnanas(300);
    const c = await acceptee([pizzas(4, 300, true)]);
    await prixAnanas(800);
    expect(await manque(c, [ananas], "cle-pf-0001")).toBe(1200);
  });

  it("le plat entier après le supplément : le supplément est déduit au prix payé", async () => {
    await prixAnanas(300);
    const c = await acceptee([pizzas(4, 300, true)]);
    await prixAnanas(800);
    expect(await manque(c, [ananas], "cle-pf-0002")).toBe(1200);
    // 4 × (2400 − 300 déjà rendus), et non 4 × (2400 − 800).
    expect(await manque(c, [{ ligne: 0, qte: 4 }], "cle-pf-0003")).toBe(8400);
  });

  it("plusieurs manques sur la même ligne, dans un geste puis en plusieurs", async () => {
    await prixAnanas(300);
    const c = await acceptee([pizzas(4, 300, true), lasagne]);
    await prixAnanas(800);
    // Une pizza entière puis l'ananas des trois autres, dans le même geste.
    expect(await manque(c, [{ ligne: 0, qte: 1 }, ananas], "cle-pf-0004")).toBe(2400 + 900);
    // Une deuxième pizza, sans son ananas déjà rendu.
    expect(await manque(c, [{ ligne: 0, qte: 1 }], "cle-pf-0005")).toBe(2100);
    // La lasagne ne prend rien au plafond de la ligne des pizzas.
    expect(await manque(c, [{ ligne: 1, qte: 1 }], "cle-pf-0006")).toBe(1800);
    expect(await manque(c, [{ ligne: 0, qte: 2 }], "cle-pf-0007")).toBe(4200);
    const total = await f<number>("(select sum(montant_centimes)::int from remboursements where commande_id = $1)", [c]);
    expect(total).toBe(9600 + 1800);
  });

  it("deux lignes dans un même geste : chaque ligne garde son plafond", async () => {
    const c = await acceptee([pizzas(4, 200, true), lasagne]);
    expect(await manque(c, [{ ligne: 0, qte: 1 }, { ligne: 1, qte: 1 }], "cle-pf-0008")).toBe(2300 + 1800);
    expect(await manque(c, [{ ligne: 0, qte: 3 }], "cle-pf-0009")).toBe(6900);
  });
});

describe("S2-13 : commande passée avant la migration (prix non figé)", () => {
  it("rembourse au prix du jour, plafonné par le total de la ligne", async () => {
    const c = await acceptee([pizzas(1, 200, false), lasagne]);
    await prixAnanas(5000);
    // 5000 au prix du jour, mais la ligne n'a coûté que 2300.
    expect(await manque(c, [ananas], "cle-pf-0010")).toBe(2300);
  });

  it("plafonne par ce qui reste de la ligne après un premier manque", async () => {
    const c = await acceptee([pizzas(2, 200, false), lasagne]);
    await prixAnanas(3000);
    // L'ananas des deux pizzas : 2 × 3000, plafonné à la ligne (4600).
    expect(await manque(c, [ananas], "cle-pf-0011")).toBe(4600);
    // Plus rien sur la ligne des pizzas.
    expect(await erreur("signaler_manque($1, $2, 'cle-pf-0012', $3, true)", [c, [{ ligne: 0, qte: 2 }], service])).toContain("montant_trop_eleve");
    // L'autre ligne reste remboursable.
    expect(await manque(c, [{ ligne: 1, qte: 1 }], "cle-pf-0013")).toBe(1800);
  });

  it("sans changement de prix, le montant ne bouge pas", async () => {
    const c = await acceptee([pizzas(2, 200, false), lasagne]);
    expect(await manque(c, [ananas], "cle-pf-0014")).toBe(400);
    expect(await manque(c, [{ ligne: 0, qte: 2 }], "cle-pf-0015")).toBe(4200);
  });
});
