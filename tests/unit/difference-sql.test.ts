import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Commande modifiée au téléphone (vague 3, bo-commandes) : à encaisser (le total change), payée moins chère
// (remboursement), payée plus chère (lien en attente du paiement, ou complément à la porte), clôture et Crésus.
// Montants tirés des commandes créées ici, jamais d'un prix de la carte.

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
const ligne = (nom: string, prix: number, qte = 1, station = "pizza") => ({
  slug: nom.toLowerCase(), nom, station, qte, unitaire_centimes: prix, total_centimes: prix * qte, choix: {}, retraits: [], note: "",
});
async function commande(opts: { comptoir?: boolean; mode?: "livraison" | "retrait" } = {}) {
  n += 1;
  const lignes = [ligne("Margherita", 2000), ligne("Tiramisu", 800, 1, "cuisine")];
  const total = 2800;
  const livraison = opts.mode === "livraison";
  const p = {
    jeton_suivi: `jeton-diff-${n}-abcdefgh`, cle_idempotence: `diff-${n}-cle-essai`, mode: opts.mode ?? "retrait",
    statut: opts.comptoir ? "nouvelle" : "paiement_en_attente", statut_paiement: opts.comptoir ? "a_encaisser_retrait" : "en_attente",
    moyen_paiement: opts.comptoir ? "comptoir" : "en_ligne", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34",
    client_email: "diff@exemple.ch", quand_type: "asap", pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0,
    total_centimes: total, tva_centimes: 71, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    adresse: livraison ? { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" } : null,
    details_livraison: livraison ? { sonnette: "Rossi", etage: "", code: "", instructions: "" } : null,
    zone_numero: livraison ? 1 : null, lignes,
  };
  const c = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set cree_le = now() where id = $1", [c]);
  if (!opts.comptoir) await f("appliquer_paiement($1, $2, 'paye', 'pi_diff', $3)", [`evt-${c}`, c, total]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c]);
  return c;
}
function demande(cle: string, lignes: ReturnType<typeof ligne>[], extra: Record<string, unknown> = {}) {
  const total = lignes.reduce((t, l) => t + l.total_centimes, 0);
  return { cle, de: "acceptee", lignes, ajouts: [], retires: [], sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: Math.round((total * 2.6) / 102.6), ...extra };
}
const modifier = (c: string, p: unknown, qui = id.gerant) => f<Record<string, unknown>>("preparer_modification($1, $2, $3)", [c, p, qui]);

beforeAll(async () => {
  db = await creerBaseLocale();
  for (const [cle, role] of [["gerant", "gerant"], ["service", "service"], ["livreur", "livreur"]] as const) {
    id[cle] = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id::text as id", [`diff-${cle}@laferme.test`, `Diff ${cle}`, role])).rows[0].id;
  }
});

describe("modifier les plats d'une commande", () => {
  it("à encaisser au comptoir : appliquée tout de suite, le total change, rien à payer à part", async () => {
    const c = await commande({ comptoir: true });
    const r = await modifier(c, demande(`difference-${n}-comptoir-0001`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")]));
    expect(r).toMatchObject({ reglement: "aucun", applique: true, difference_centimes: 2000 });
    expect((await db.query<{ total_centimes: number }>("select total_centimes from commandes where id = $1", [c])).rows[0].total_centimes).toBe(4800);
    expect((await db.query("select 1 from complements where commande_id = $1", [c])).rows).toHaveLength(0);
    expect(await f<number>("valeur_commande($1)", [c])).toBe(4800);
  });

  it("payée et moins chère : appliquée, la différence est remboursée par Stripe, le total payé ne bouge pas", async () => {
    const c = await commande();
    const r = await modifier(c, demande(`difference-${n}-moins-00001`, [ligne("Margherita", 2000)], { retires: [{ nom: "Tiramisu", qte: 1 }] }));
    expect(r).toMatchObject({ reglement: "remboursement", applique: true, difference_centimes: -800 });
    expect(r.remboursement).toMatchObject({ montant_centimes: 800, moyen: "stripe", statut: "en_cours" });
    expect((await db.query<{ total_centimes: number }>("select total_centimes from commandes where id = $1", [c])).rows[0].total_centimes).toBe(2800);
    expect((await db.query("select 1 from commande_lignes where commande_id = $1", [c])).rows).toHaveLength(1);
  });

  it("payée et plus chère par lien : rien ne change avant le paiement ; paiement reçu une fois, au bon montant", async () => {
    const c = await commande();
    const r = await modifier(c, demande(`difference-${n}-lien-000001`, [ligne("Margherita", 2000), ligne("Tiramisu", 800, 2, "cuisine")], { reglement: "lien", ajouts: [ligne("Tiramisu", 800, 1, "cuisine")] }));
    expect(r).toMatchObject({ reglement: "lien", applique: false, statut: "en_attente", difference_centimes: 800 });
    expect(await f<number>("valeur_commande($1)", [c])).toBe(2800);
    // Une seconde modification attend la fin de la première.
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-autre-00001`, [ligne("Margherita", 2000)]), id.gerant])).toContain("modification_en_attente");
    const m = r.id as string;
    expect(await f<{ applique: boolean; raison: string }>("appliquer_modification($1)", [m])).toMatchObject({ applique: false, raison: "paiement_attendu" });
    expect(await f<{ applique: boolean; raison: string }>("appliquer_modification($1, 'evt-faux', 'pi_c', 500)", [m])).toMatchObject({ applique: false, raison: "montant" });
    const ok = await f<{ applique: boolean; ajouts: unknown[] }>("appliquer_modification($1, 'evt-lien-1', 'pi_c', 800)", [m]);
    expect(ok.applique).toBe(true);
    expect(ok.ajouts).toHaveLength(1);
    expect(await f<{ applique: boolean }>("appliquer_modification($1, 'evt-lien-1', 'pi_c', 800)", [m])).toMatchObject({ applique: false });
    const k = (await db.query<{ moyen: string; statut: string; montant_centimes: number }>("select moyen, statut, montant_centimes from complements where commande_id = $1", [c])).rows;
    expect(k).toEqual([{ moyen: "en_ligne", statut: "encaisse", montant_centimes: 800 }]);
    expect(await f<number>("valeur_commande($1)", [c])).toBe(3600);
  });

  it("payée et plus chère, à la porte : complément à encaisser, encaissé par son livreur seulement, puis dans la clôture et Crésus", async () => {
    const c = await commande({ mode: "livraison" });
    const jour0 = (await db.query<{ j: string }>("select jour_service::text as j from commandes where id = $1", [c])).rows[0].j;
    const ttcAvant = (await f<{ ttc_centimes: number }>("pilotage_synthese($1, $1)", [jour0])).ttc_centimes;
    const r = await modifier(c, demande(`difference-${n}-porte-00001`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")], { reglement: "porte" }));
    expect(r).toMatchObject({ reglement: "porte", applique: true });
    // Les ventes de la synthèse (et de la clôture) voient le complément, comme les encaissements.
    expect((await f<{ ttc_centimes: number }>("pilotage_synthese($1, $1)", [jour0])).ttc_centimes - ttcAvant).toBe(2000);
    const k = (await db.query<{ id: string }>("select id from complements where commande_id = $1", [c])).rows[0].id;
    const jour = (await db.query<{ j: string }>("select jour_service::text as j from commandes where id = $1", [c])).rows[0].j;
    const avant = await f<{ ecarts: { type: string }[]; encaissements: { complements: { a_encaisser_centimes: number } } }>("cloture_rapport($1)", [jour]);
    expect(avant.encaissements.complements.a_encaisser_centimes).toBeGreaterThanOrEqual(2000);
    expect(await erreur("encaisser_complement($1, 'especes', $2)", [k, id.livreur])).toContain("droit_refuse");
    await db.query("insert into livraisons (commande_id, livreur_id, attribuee_par) values ($1, $2, 'test')", [c, id.livreur]);
    expect(await f<boolean>("encaisser_complement($1, 'especes', $2)", [k, id.livreur])).toBe(true);
    expect(await f<boolean>("encaisser_complement($1, 'carte', $2)", [k, id.livreur])).toBe(false);
    const apres = await f<{ encaissements: { complements: { especes_centimes: number } } }>("cloture_rapport($1)", [jour]);
    expect(apres.encaissements.complements.especes_centimes).toBeGreaterThanOrEqual(2000);
    const cresus = await f<{ sorte: string; moyen: string; ttc_centimes: number }[]>("export_cresus($1, $1)", [jour]);
    expect(cresus.some((l) => l.sorte === "vente" && l.moyen === "caisse" && l.ttc_centimes >= 2000)).toBe(true);
  });

  it("lien abandonné puis payé : l'argent est noté, à rembourser, sans modification appliquée", async () => {
    const c = await commande();
    const r = await modifier(c, demande(`difference-${n}-aband-001`, [ligne("Margherita", 2000), ligne("Tiramisu", 800, 2, "cuisine")], { reglement: "lien" }));
    const m = r.id as string;
    await db.query("select lier_session_modification($1, 'cs_test_aband')", [m]);
    expect(await f<{ abandonnee: boolean }>("abandonner_modification($1, $2)", [m, id.gerant])).toMatchObject({ abandonnee: true });
    const paye = await f<{ applique: boolean; raison: string; a_rembourser: boolean }>("confirmer_complement($1, 'cs_test_aband', 'evt-aband-1', 'pi_aband', 800, 'chf')", [m]);
    expect(paye).toMatchObject({ applique: false, raison: "abandonnee_payee", a_rembourser: true });
    expect((await db.query<{ statut: string }>("select statut from modifications_commande where id = $1", [m])).rows[0].statut).toBe("payee_non_appliquee");
    // Rejoué : rien de plus.
    expect(await f<{ raison: string }>("confirmer_complement($1, 'cs_test_aband', 'evt-aband-1', 'pi_aband', 800, 'chf')", [m])).toMatchObject({ raison: "deja" });
    expect(await f<number>("valeur_commande($1)", [c])).toBe(2800);
  });

  it("nouvelle adresse dans une zone plus chère, puis une autre dans la même zone : les frais ne se paient qu'une fois", async () => {
    const c = await commande({ mode: "livraison" });
    const lignes = [ligne("Margherita", 2000), ligne("Tiramisu", 800, 1, "cuisine")];
    const zone2 = { adresse: { rue: "Rue de Lancy", numero: "5", npa: "1212", localite: "Grand-Lancy" }, zone_numero: 2, frais_centimes: 500, total_centimes: 3300, reglement: "porte" };
    const r1 = await modifier(c, demande(`difference-${n}-zone2-001`, lignes, zone2));
    expect(r1).toMatchObject({ reglement: "porte", applique: true, difference_centimes: 500 });
    expect((await db.query<{ frais_centimes: number }>("select frais_centimes from complements where commande_id = $1", [c])).rows[0].frais_centimes).toBe(500);
    // Rapports et export : les mêmes frais une fois le complément encaissé (relecture de bo-pilotage).
    const kz = (await db.query<{ id: string }>("select id from complements where commande_id = $1", [c])).rows[0].id;
    expect(await f<boolean>("encaisser_complement($1, 'carte', $2)", [kz, id.gerant])).toBe(true);
    const jour = (await db.query<{ j: string }>("select jour_service::text as j from commandes where id = $1", [c])).rows[0].j;
    const recap = await f<{ frais_centimes: number }[]>("export_recap_jours($1, $1)", [jour]);
    expect((await f<{ frais_centimes: number }>("pilotage_synthese($1, $1)", [jour])).frais_centimes).toBe(recap.reduce((t, l) => t + l.frais_centimes, 0));
    expect(await f<number>("valeur_commande($1)", [c])).toBe(3300);
    const r2 = await modifier(c, demande(`difference-${n}-zone2-002`, lignes, { ...zone2, adresse: { ...zone2.adresse, numero: "7" } }));
    expect(r2).toMatchObject({ reglement: "aucun", difference_centimes: 0 });
  });

  it("baisse après un complément encore dû : le complément se réduit, rien n'est remboursé ; pas d'encaissement d'une commande annulée", async () => {
    const c = await commande({ mode: "livraison" });
    await modifier(c, demande(`difference-${n}-dette-001`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")], { reglement: "porte" }));
    const baisse = await modifier(c, demande(`difference-${n}-dette-002`, [ligne("Margherita", 2000, 2)]));
    expect(baisse).toMatchObject({ reglement: "remboursement", applique: true, difference_centimes: -800 });
    expect(baisse.remboursement).toBeNull();
    expect((await db.query("select 1 from remboursements where commande_id = $1", [c])).rows).toHaveLength(0);
    const k = (await db.query<{ id: string; montant_centimes: number }>("select id, montant_centimes from complements where commande_id = $1", [c])).rows;
    expect(k.map((x) => x.montant_centimes)).toEqual([1200]);
    await db.query("update commandes set statut = 'annulee' where id = $1", [c]);
    expect(await f<boolean>("encaisser_complement($1, 'especes', $2)", [k[0].id, id.gerant])).toBe(false);
  });

  it("la commande a changé depuis le calcul : refus, rien n'est enregistré", async () => {
    const c = await commande({ comptoir: true });
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-perime-01`, [ligne("Margherita", 2000, 2)], { valeur_avant: 1234 }), id.gerant])).toContain("deja_change");
  });

  it("droits et refus : l'équipe de service non, un règlement absent ou impossible non", async () => {
    const c = await commande({ mode: "livraison" });
    const plus = [ligne("Margherita", 2000, 3), ligne("Tiramisu", 800, 1, "cuisine")];
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-svc-000001`, plus, { reglement: "lien" }), id.service])).toContain("droit_refuse");
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-sans-00001`, plus), id.gerant])).toContain("reglement_invalide");
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-cptr-00001`, plus, { reglement: "comptoir" }), id.gerant])).toContain("reglement_invalide");
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-de-0000001`, plus, { reglement: "porte", de: "prete" }), id.gerant])).toContain("deja_change");
  });
});
