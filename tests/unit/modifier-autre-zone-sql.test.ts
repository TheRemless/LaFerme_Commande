import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes, D4 : adresse corrigée dans une autre zone, désactivée par défaut. Permise seulement
// si les frais de la nouvelle zone ne dépassent pas ceux payés et si le minimum est atteint. Montants posés ici.

let db: PGlite;
let gerant: string;
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
async function livraison(frais: number, sousTotal: number): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-az-${n}`, cle_idempotence: `az-${n}`, mode: "livraison", statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "G", client_nom: "R", client_telephone: "079 555 12 34", client_email: `az${n}@exemple.ch`, quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: sousTotal, frais_centimes: frais, total_centimes: sousTotal + frais, tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" }, details_livraison: { sonnette: "R", etage: "", code: "", instructions: "" }, zone_numero: 2,
    lignes: [{ slug: "x", nom: "X", station: "cuisine", qte: 1, unitaire_centimes: sousTotal, total_centimes: sousTotal, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await f("appliquer_paiement($1, $2, 'paye', 'pi_az', $3)", [`evt-${id}`, id, sousTotal + frais]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [id]);
  return id;
}
const nouvelle = (zone: number, frais: number, minimum: number) => ({
  adresse: { rue: "Avenue du Lignon", numero: "5", npa: "1219", localite: "Le Lignon" }, zone_numero: zone, zone_frais_centimes: frais, zone_minimum_centimes: minimum,
});

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'gerant-bureau@laferme.test'")).rows[0].id;
});

describe("D4 : adresse dans une autre zone", () => {
  it("refusée par défaut, même moins chère", async () => {
    const c = await livraison(500, 4000);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, nouvelle(1, 300, 2000), gerant])).toContain("zone_differente");
  });

  it("activée : permise si pas plus chère et minimum atteint ; les frais payés restent", async () => {
    await db.query("update reglages set valeur = 'true' where cle = 'modification_autre_zone'");
    const c = await livraison(500, 4000);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, nouvelle(3, 700, 2000), gerant])).toContain("zone_differente");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, nouvelle(3, 300, 5000), gerant])).toContain("zone_differente");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { adresse: nouvelle(1, 300, 2000).adresse, zone_numero: 1 }, gerant])).toContain("zone_differente");
    const r = await f<{ champs: string[] }>("modifier_commande($1, $2, $3, 'x')", [c, nouvelle(1, 300, 2000), gerant]);
    expect(r.champs).toEqual(["adresse", "zone_numero"]);
    const apres = (await db.query<{ zone_numero: number; frais_centimes: number; total_centimes: number }>("select zone_numero, frais_centimes, total_centimes from commandes where id = $1", [c])).rows[0];
    expect(apres).toEqual({ zone_numero: 1, frais_centimes: 500, total_centimes: 4500 });
  });

  it("même zone : inchangé, sans réglage", async () => {
    const c = await livraison(500, 4000);
    const r = await f<{ champs: string[] }>("modifier_commande($1, $2, $3, 'x')", [c, { adresse: nouvelle(2, 0, 0).adresse, zone_numero: 2 }, gerant]);
    expect(r.champs).toEqual(["adresse"]);
  });
});
