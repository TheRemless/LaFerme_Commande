import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Heure promise réaliste, version 2 (vague 3, bo-operations) : charge_livraison(), migration
// 20261130210000_charge_livraison.sql. Livreurs présents d'après le planning, livraisons à faire ou en route.
// Horloge simulée comme heure-reelle-sql.test.ts.

let db: PGlite;
const ids: Record<string, string> = {};

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
const regler = (cle: string, valeur: unknown) => db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);
type Livraison = { livraisons: number; livreurs: number; attente_minutes: number; compte: boolean; allongement_minutes: number };
const charge = async () => (await db.query<{ r: Livraison }>("select charge_livraison() as r")).rows[0].r;

let n = 0;
// Commande au mode, au statut et à l'heure confirmée donnés (une pizza, sans importance ici).
async function commande(o: { mode?: "livraison" | "retrait"; statut?: string; due?: string | null } = {}): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-cl-${n}`,
    cle_idempotence: `cl-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `L${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "cl@laferme.test",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1500,
    frais_centimes: 0,
    total_centimes: 1500,
    tva_centimes: 38,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set mode = $2, statut = $3, heure_confirmee = $4::timestamptz where id = $1", [
    id,
    o.mode ?? "livraison",
    o.statut ?? "acceptee",
    o.due === undefined ? "2026-11-20T18:30:00Z" : o.due,
  ]);
  return id;
}
async function livraisons(k: number, statut = "acceptee") {
  for (let i = 0; i < k; i++) await commande({ statut });
}
// Semaine type : vendredi (5) soir pour les livreurs donnés.
async function semaine(...cles: string[]) {
  for (const c of cles) await db.query("insert into livreurs_semaine (livreur_id, jour, service) values ($1, 5, 'soir')", [ids[c]]);
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
    update personnel set actif = false where role = 'livreur';
  `);
  for (const cle of ["marco", "ines", "sami"]) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, 'livreur') returning id", [`cl-${cle}@laferme.test`, `Cl ${cle}`]);
    ids[cle] = r.rows[0].id;
  }
}, 120_000);

beforeEach(async () => {
  await db.exec("truncate commandes cascade; delete from livreurs_semaine where true; delete from livreurs_jours where true;");
  // Vendredi 20 novembre 2026, 19h00 à Genève (18h00 UTC), service du soir.
  await horloge("2026-11-20T18:00:00Z");
  await regler("preparation_minutes", 20);
  await regler("allongement_max_minutes", 45);
  await regler("livraisons_par_livreur_heure", 3);
  await db.exec("update zones_livraison set active = true, delai_max = 45 where numero = 1");
});

describe("charge_livraison", () => {
  it("réglage de départ à 0, proposition : livraison pas comptée", async () => {
    const r = await db.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = 'livraisons_par_livreur_heure'");
    expect(r.rows[0].proposition).toBe(true);
    await regler("livraisons_par_livreur_heure", 0);
    await semaine("marco");
    await livraisons(6);
    expect(await charge()).toEqual({ livraisons: 6, livreurs: 1, attente_minutes: 0, compte: false, allongement_minutes: 0 });
  });

  it("un seul livreur au lieu de deux, quatre livraisons : +60 min d'attente, +40 annoncées", async () => {
    await semaine("marco", "ines");
    await db.query("insert into livreurs_jours (livreur_id, jour, service, present, motif) values ($1, '2026-11-20', 'soir', false, 'Malade')", [ids.ines]);
    await livraisons(2, "acceptee");
    await livraisons(2, "partie");
    const c = await charge();
    // 2 à faire et 2 parties (pour moitié) : 3 livraisons pour 1 livreur à 3 par heure, 60 min.
    // 60 - 20 de préparation = 40.
    expect(c).toMatchObject({ livraisons: 4, livreurs: 1, attente_minutes: 60, compte: true, allongement_minutes: 40 });
    // Deux livreurs : 30 min d'attente, 10 de plus que la préparation.
    await db.exec("delete from livreurs_jours where true");
    expect(await charge()).toMatchObject({ livreurs: 2, attente_minutes: 30, allongement_minutes: 10 });
  });

  it("plafonné par allongement_max_minutes", async () => {
    await semaine("marco");
    await livraisons(6);
    // 6 livraisons, 1 livreur à 3 par heure : 120 min, 100 de plus que la préparation, plafonné à 45.
    expect(await charge()).toMatchObject({ attente_minutes: 120, allongement_minutes: 45 });
  });

  it("planning tenu à moitié : un livreur qui a reçu une livraison depuis deux heures compte", async () => {
    await db.query("insert into livreurs_jours (livreur_id, jour, service, present) values ($1, '2026-11-20', 'soir', true)", [ids.sami]);
    const id = await commande();
    await db.query("insert into livraisons (commande_id, livreur_id, attribuee_par, attribuee_le) values ($1, $2, 'test', '2026-11-20T17:30:00Z')", [id, ids.marco]);
    expect((await charge()).livreurs).toBe(2);
    // Attribuée il y a trois heures : plus compté.
    await db.query("update livraisons set attribuee_le = '2026-11-20T15:00:00Z' where commande_id = $1", [id]);
    expect((await charge()).livreurs).toBe(1);
  });

  it("renfort du jour compté, livreur désactivé non", async () => {
    await semaine("marco");
    await db.query("insert into livreurs_jours (livreur_id, jour, service, present) values ($1, '2026-11-20', 'soir', true)", [ids.sami]);
    expect((await charge()).livreurs).toBe(2);
    await db.query("update personnel set actif = false where id = $1", [ids.sami]);
    expect((await charge()).livreurs).toBe(1);
    await db.query("update personnel set actif = true where id = $1", [ids.sami]);
  });

  it("aucun livreur prévu ce service (planning pas tenu) : pas compté", async () => {
    await livraisons(5);
    expect(await charge()).toMatchObject({ livreurs: 0, attente_minutes: 0, compte: false, allongement_minutes: 0 });
  });

  it("service du midi avant 15h, du soir ensuite", async () => {
    await db.query("insert into livreurs_semaine (livreur_id, jour, service) values ($1, 5, 'midi')", [ids.marco]);
    expect((await charge()).livreurs).toBe(0);
    await horloge("2026-11-20T11:00:00Z");
    expect((await charge()).livreurs).toBe(1);
  });

  it("ne compte que les livraisons pas terminées, dues bientôt et pas oubliées", async () => {
    await semaine("marco");
    await commande({ statut: "nouvelle", due: null });
    await commande({ statut: "prete" });
    await commande({ statut: "partie" });
    await commande({ mode: "retrait" });
    await commande({ statut: "terminee" });
    await commande({ statut: "refusee" });
    // Pour 21h30 (après le délai de zone le plus long et l'allongement maximal).
    await commande({ due: "2026-11-20T20:30:00Z" });
    // Due il y a deux heures, jamais terminée : oubliée.
    await commande({ due: "2026-11-20T16:00:00Z" });
    expect((await charge()).livraisons).toBe(3);
  });

  it("aucune donnée de client ni nom de livreur, exécution réservée au serveur", async () => {
    await semaine("marco");
    await livraisons(2);
    expect(Object.keys(await charge()).sort()).toEqual(["allongement_minutes", "attente_minutes", "compte", "livraisons", "livreurs"]);
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'charge_livraison()', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it("réglage modifiable de 0 à 20 au back-office", async () => {
    const gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('cl-gerant@laferme.test', 'Cl gérant', 'gerant') returning id")).rows[0].id;
    await db.query("select regler_reglage_general('livraisons_par_livreur_heure', '4', $1)", [gerant]);
    const r = await db.query<{ rythme: Record<string, number> }>("select reglages_generaux() -> 'rythme' as rythme");
    expect(r.rows[0].rythme.livraisons_par_livreur_heure).toBe(4);
    await expect(db.query("select regler_reglage_general('livraisons_par_livreur_heure', '21', $1)", [gerant])).rejects.toThrow(/hors limites/);
  });
});
