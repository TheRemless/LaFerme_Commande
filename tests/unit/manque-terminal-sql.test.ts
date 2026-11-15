import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Manque signalé à la tablette, rendu par le moyen qui a encaissé (décision du chef du 15.11.2026, migration
// 20261216170000) : carte au comptoir, terminal ; espèces, espèces ; proposé, changeable, noté au journal.

let db: PGlite;
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
async function id(email: string): Promise<string> {
  return (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
}

let n = 0;
// Deux Margherita avec ananas (unitaire 2300) et une lasagne (1800) : 6400 au total.
function commande(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-mt-${n}`,
    cle_idempotence: `mt-${n}`,
    mode: "retrait",
    statut: "paiement_en_attente",
    statut_paiement: "en_attente",
    moyen_paiement: "en_ligne",
    client_prenom: `V${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "v2@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 6400,
    frais_centimes: 0,
    total_centimes: 6400,
    tva_centimes: 162,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2300, total_centimes: 4600, choix: { "supplements-pizza": ["Ananas"] }, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" },
    ],
    ...extra,
  };
}

async function acceptee(extra: Record<string, unknown> = {}, payer = true): Promise<{ id: string; numero: number }> {
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [commande(extra)])).rows[0];
  if (payer) await f("appliquer_paiement($1, $2, 'paye', 'pi_v2', 6400)", [`evt-${c.id}`, c.id]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  return c;
}

let service: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  service = await id("equipe-bureau@laferme.test");
});

async function encaissee(moyen: "carte" | "especes" | null) {
  const c = await acceptee({ statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir" }, false);
  expect(await f<boolean>("marquer_encaisse($1, 'tablette:Test', $2)", [c.id, moyen])).toBe(true);
  return c;
}
const lasagne = [{ ligne: 1, qte: 1 }];
const journal = async (c: string) => (await db.query<{ detail: string }>("select detail from evenements_commande where commande_id = $1 and vers = 'manque'", [c])).rows.map((x) => x.detail);

describe("manque : rendre par le moyen qui a encaissé", () => {
  it("payée par carte au comptoir : terminal proposé à l'estimation, rendu sur le terminal, noté au journal", async () => {
    const c = await encaissee("carte");
    expect(await f("signaler_manque($1, $2, 'cle-mt-0001', $3, false)", [c.id, lasagne, service])).toMatchObject({ montant_centimes: 1800, moyen: "terminal", moyen_propose: "terminal" });
    expect(await f("signaler_manque($1, $2, 'cle-mt-0002', $3, true)", [c.id, lasagne, service])).toMatchObject({ moyen: "terminal", statut: "fait", montant_centimes: 1800 });
    expect(await journal(c.id)).toEqual(["18.00 CHF, 1 × Lasagne de bœuf, rendu sur le terminal"]);
  });

  it("payée en espèces (ou moyen pas noté) : espèces", async () => {
    for (const [moyen, cle] of [["especes", "cle-mt-0003"], [null, "cle-mt-0004"]] as const) {
      const c = await encaissee(moyen);
      expect(await f("signaler_manque($1, $2, $3, $4, true)", [c.id, lasagne, cle, service])).toMatchObject({ moyen: "especes" });
    }
  });

  it("changé par l'équipe (client qui préfère des espèces) : rendu en espèces, le moyen proposé reste au journal", async () => {
    const c = await encaissee("carte");
    expect(await f("signaler_manque($1, $2, 'cle-mt-0005', $3, true, 'especes')", [c.id, lasagne, service])).toMatchObject({ moyen: "especes" });
    expect(await journal(c.id)).toEqual(["18.00 CHF, 1 × Lasagne de bœuf, rendu en espèces (proposé : terminal)"]);
  });

  it("payée en ligne ou pas encore encaissée : Stripe ou déduction, le moyen choisi n'y change rien", async () => {
    const enLigne = await acceptee();
    expect(await f("signaler_manque($1, $2, 'cle-mt-0006', $3, false, 'especes')", [enLigne.id, lasagne, service])).toMatchObject({ moyen: "stripe" });
    const comptoir = await acceptee({ statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir" }, false);
    expect(await f("signaler_manque($1, $2, 'cle-mt-0007', $3, true, 'terminal')", [comptoir.id, lasagne, service])).toMatchObject({ moyen: "deduction" });
  });

  it("moyen inconnu refusé ; réservée à la clé de service", async () => {
    const c = await encaissee("carte");
    expect(await erreur("signaler_manque($1, $2, 'cle-mt-0008', $3, true, 'cheque')", [c.id, lasagne, service])).toContain("moyen_invalide");
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'signaler_manque(uuid, jsonb, text, uuid, boolean, text)', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
