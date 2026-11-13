import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Responsable de service (D1, part de bo-commandes) : il rembourse après coup comme le gérant, à son nom ;
// l'équipe de service ne peut pas ; rôle éteint (role_responsable_actif à false), il ne peut plus. Montants des
// commandes créées ici.

let db: PGlite;
const id: Record<string, string> = {};
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
const activer = (oui: boolean) =>
  db.query("insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', $1::jsonb, false) on conflict (cle) do update set valeur = excluded.valeur", [oui ? "true" : "false"]);

async function terminee(): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-resp-${n}-abcdef`, cle_idempotence: `resp-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: "resp@exemple.ch",
    quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 4000, frais_centimes: 0, total_centimes: 4000, tva_centimes: 0,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "x", nom: "Pizza", station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set cree_le = now() where id = $1", [c]);
  await f("appliquer_paiement($1, $2, 'paye', 'pi_resp', 4000)", [`evt-${c}`, c]);
  for (const e of ["acceptee", "prete", "terminee"]) await f("changer_statut($1, $2, 'tablette:Test', $3)", [c, e, e === "acceptee" ? new Date().toISOString() : null]);
  return c;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  for (const [cle, role] of [["responsable", "responsable"], ["service", "service"]] as const) {
    id[cle] = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id::text as id", [`rc-${cle}@laferme.test`, `Rc ${cle}`, role])).rows[0].id;
  }
});

describe("rembourser après coup (D1)", () => {
  it("le responsable rembourse, à son nom ; l'équipe de service ne peut pas", async () => {
    await activer(true);
    const c = await terminee();
    const r = await f<{ statut: string; personnel_nom: string }>("demander_remboursement($1, 1000, 'Pizza froide', 'cle-resp-1', $2)", [c, id.responsable]);
    expect(r).toMatchObject({ statut: "en_cours", personnel_nom: "Rc responsable" });
    expect(await erreur("demander_remboursement($1, 500, 'Encore', 'cle-resp-2', $2)", [c, id.service])).toContain("droit_refuse");
  });

  it("rôle éteint : le responsable ne rembourse plus", async () => {
    await activer(false);
    const c = await terminee();
    expect(await erreur("demander_remboursement($1, 1000, 'Pizza froide', 'cle-resp-3', $2)", [c, id.responsable])).toContain("droit_refuse");
    await activer(true);
  });
});
