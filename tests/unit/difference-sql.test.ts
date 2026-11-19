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
// remise : une réduction du départ (code promo, cagnotte) déduite du total payé ou à payer.
async function commande(opts: { comptoir?: boolean; mode?: "livraison" | "retrait"; remise?: number } = {}) {
  n += 1;
  const lignes = [ligne("Margherita", 2000), ligne("Tiramisu", 800, 1, "cuisine")];
  const total = 2800 - (opts.remise ?? 0);
  const livraison = opts.mode === "livraison";
  const p = {
    jeton_suivi: `jeton-diff-${n}-abcdefgh`, cle_idempotence: `diff-${n}-cle-essai`, mode: opts.mode ?? "retrait",
    statut: opts.comptoir ? "nouvelle" : "paiement_en_attente", statut_paiement: opts.comptoir ? "a_encaisser_retrait" : "en_attente",
    moyen_paiement: opts.comptoir ? "comptoir" : "en_ligne", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34",
    client_email: "diff@exemple.ch", quand_type: "asap", pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0,
    total_centimes: total, tva_centimes: 71, taux_tva_pourcent: 2.6, origine: "http://localhost:3000", remise_centimes: opts.remise ?? 0,
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

  it("R21 : l'état d'avant reste sur la modification, un complément dû ramené à zéro est annulé, jamais supprimé", async () => {
    const c = await commande({ mode: "livraison" });
    const lignesDepart = (await db.query<{ nom: string; qte: number; total_centimes: number }>(
      "select nom, qte, total_centimes from commande_lignes where commande_id = $1 order by position", [c])).rows;
    const avant = (await db.query<{ total_centimes: number; tva_centimes: number }>("select total_centimes, tva_centimes from commandes where id = $1", [c])).rows[0];
    await modifier(c, demande(`difference-${n}-r21-0001`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")], { reglement: "porte" }));
    const m1 = (await db.query<{ lignes_avant: { nom: string; qte: number; total_centimes: number }[]; commande_avant: { total_centimes: number; tva_centimes: number } }>(
      "select lignes_avant, commande_avant from modifications_commande where commande_id = $1 order by cree_le limit 1", [c])).rows[0];
    expect(m1.lignes_avant.map((l) => ({ nom: l.nom, qte: l.qte, total_centimes: l.total_centimes }))).toEqual(lignesDepart);
    expect(m1.commande_avant).toMatchObject({ total_centimes: avant.total_centimes, tva_centimes: avant.tva_centimes });
    const k = (await db.query<{ id: string; montant_centimes: number }>("select id, montant_centimes from complements where commande_id = $1", [c])).rows[0];

    // Retour à la commande de départ : le complément dû tombe à zéro. Annulé, pas supprimé ; son montant reste.
    await modifier(c, demande(`difference-${n}-r21-0002`, [ligne("Margherita", 2000), ligne("Tiramisu", 800, 1, "cuisine")]));
    const apres = (await db.query<{ statut: string; montant_centimes: number; annule_le: string | null; annule_par_modification: string | null }>(
      "select statut, montant_centimes, annule_le, annule_par_modification from complements where id = $1", [k.id])).rows[0];
    expect(apres).toMatchObject({ statut: "annule", montant_centimes: k.montant_centimes });
    expect(apres.annule_le).not.toBeNull();
    const m2 = (await db.query<{ id: string; complements_avant: { id: string; montant_centimes: number; statut: string }[]; lignes_avant: unknown[] }>(
      "select id, complements_avant, lignes_avant from modifications_commande where commande_id = $1 order by cree_le desc limit 1", [c])).rows[0];
    expect(apres.annule_par_modification).toBe(m2.id);
    expect(m2.complements_avant).toEqual([expect.objectContaining({ id: k.id, montant_centimes: k.montant_centimes, statut: "a_encaisser" })]);
    expect(m2.lignes_avant).toHaveLength(2);
    // Un complément annulé ne s'encaisse pas et ne compte ni à la clôture ni dans les ventes.
    expect(await f<boolean>("encaisser_complement($1, 'especes', $2)", [k.id, id.gerant])).toBe(false);
    const jour = (await db.query<{ j: string }>("select jour_service::text as j from commandes where id = $1", [c])).rows[0].j;
    const cl = await f<{ encaissements: { complements: { a_encaisser_centimes: number } }; ecarts: { type: string; numero?: number }[] }>("cloture_rapport($1)", [jour]);
    const numero = (await db.query<{ numero: number }>("select numero from commandes where id = $1", [c])).rows[0].numero;
    expect(cl.ecarts.some((e) => e.type === "complement_sans_encaissement" && e.numero === numero)).toBe(false);
    // Synthèse : les ventes reviennent à celles du départ, le complément annulé n'y compte plus.
    const synthese = await f<{ ttc_centimes: number }>("pilotage_synthese($1, $1)", [jour]);
    const sansCommande = (await db.query<{ t: number }>("select coalesce(sum(total_centimes), 0)::int as t from commandes where jour_service = $1 and statut not in ('paiement_en_attente', 'annulee', 'refusee')", [jour])).rows[0].t;
    const complementsVivants = (await db.query<{ t: number }>(
      "select coalesce(sum(k.montant_centimes), 0)::int as t from complements k join commandes o on o.id = k.commande_id where o.jour_service = $1 and k.statut in ('a_encaisser', 'encaisse') and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')", [jour])).rows[0].t;
    expect(synthese.ttc_centimes).toBe(sansCommande + complementsVivants);
  });

  it("R16 : un plat offert reste dans la commande, à 0 CHF, quand le client change ses plats", async () => {
    const c = await commande({ comptoir: true });
    const offerte = (await db.query<{ id: string }>(
      "insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, note, offert) values ($1, 3, 'tiramisu', 'Tiramisu', 'cuisine', 1, 0, 0, 'Offert', true) returning id",
      [c],
    )).rows[0].id;
    await modifier(c, demande(`difference-${n}-offert-01`, [ligne("Margherita", 2000, 2)]));
    const lignes = (await db.query<{ nom: string; total_centimes: number; offert: boolean }>(
      "select nom, total_centimes, offert from commande_lignes where commande_id = $1 order by position", [c])).rows;
    expect(lignes).toEqual([
      { nom: "Margherita", total_centimes: 4000, offert: false },
      { nom: "Tiramisu", total_centimes: 0, offert: true },
    ]);
    // La même ligne (le geste la désigne par son id), passée après les nouvelles.
    expect((await db.query<{ position: number }>("select position from commande_lignes where id = $1", [offerte])).rows[0].position).toBe(2);
    await expect(db.query("update commande_lignes set total_centimes = 500 where commande_id = $1 and offert", [c])).rejects.toThrow();
  });

  it("la commande a changé depuis le calcul : refus, rien n'est enregistré", async () => {
    const c = await commande({ comptoir: true });
    expect(await erreur("preparer_modification($1, $2, $3)", [c, demande(`difference-${n}-perime-01`, [ligne("Margherita", 2000, 2)], { valeur_avant: 1234 }), id.gerant])).toContain("deja_change");
  });

  it("à encaisser avec une remise : le nouveau total garde la remise (relecture de bo-pilotage)", async () => {
    const c = await commande({ comptoir: true, remise: 500 });
    await modifier(c, demande(`difference-${n}-remise-01`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")]));
    const o = (await db.query<{ total_centimes: number; tva_centimes: number }>("select total_centimes, tva_centimes from commandes where id = $1", [c])).rows[0];
    expect(o.total_centimes).toBe(4800 - 500);
    expect(o.tva_centimes).toBe(Math.round((4300 * 2.6) / 102.6));
  });

  it("à encaisser avec une remise, modifiée puis encaissée : récapitulatif, Crésus et clôture bougent du même montant", async () => {
    const c = await commande({ comptoir: true, remise: 500 });
    const jour = (await db.query<{ j: string }>("select jour::text as j from commandes where id = $1", [c])).rows[0].j;
    const chiffres = async () => {
      const recap = await f<{ ttc_centimes: number }[]>("export_recap_jours($1, $1)", [jour]);
      const cresus = await f<{ sorte: string; ttc_centimes: number }[]>("export_cresus($1, $1)", [jour]);
      const cl = await f<{ encaissements: { en_ligne: { centimes: number }; comptoir: { centimes: number }; complements: { especes_centimes: number; carte_centimes: number } } }>("cloture_rapport($1)", [jour]);
      return {
        recap: recap.reduce((t, l) => t + Number(l.ttc_centimes), 0),
        cresus: cresus.filter((l) => l.sorte === "vente").reduce((t, l) => t + Number(l.ttc_centimes), 0),
        cloture: Number(cl.encaissements.en_ligne.centimes) + Number(cl.encaissements.comptoir.centimes) + Number(cl.encaissements.complements.especes_centimes) + Number(cl.encaissements.complements.carte_centimes),
      };
    };
    const avant = await chiffres();
    await modifier(c, demande(`difference-${n}-croise-01`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")]));
    await f("marquer_encaisse($1, 'tablette:Test', 'especes')", [c]);
    const apres = await chiffres();
    expect(apres.recap - avant.recap).toBe(4300);
    expect(apres.cresus - avant.cresus).toBe(4300);
    expect(apres.cloture - avant.cloture).toBe(4300);
  });

  it("payée avec une remise, baisse plus grande que le paiement : remboursement plafonné à ce qui a été payé", async () => {
    const c = await commande({ remise: 1300 });
    const r = await modifier(c, demande(`difference-${n}-plafond-1`, [ligne("Tiramisu", 800, 1, "cuisine")]));
    expect(r).toMatchObject({ reglement: "remboursement", applique: true, difference_centimes: -2000 });
    expect(r.remboursement).toMatchObject({ montant_centimes: 1500 });
    // Plafond dit et journalisé : voulu 20.00, rendu 15.00 (le reste était la remise).
    expect(r).toMatchObject({ rembourse_voulu_centimes: 2000, rembourse_centimes: 1500 });
    const j = (await db.query<{ apres: Record<string, number> }>("select apres from journal_gestion where objet = 'commande_modifiee' and cle = $1 order by id desc limit 1", [c])).rows[0];
    expect(j.apres).toMatchObject({ rembourse_voulu_centimes: 2000, rembourse_centimes: 1500 });
  });

  it("payée (avec remise), complément payé par le lien, puis baisse plus grande que le paiement de départ : le surplus part sur le paiement du complément", async () => {
    const c = await commande({ remise: 800 });
    const plus = [ligne("Margherita", 2000), ligne("Tiramisu", 800, 1, "cuisine"), ligne("Calzone", 1500)];
    const r1 = await modifier(c, demande(`difference-${n}-surplus-1`, plus, { reglement: "lien" }));
    await db.query("select lier_session_modification($1, 'cs_test_surplus')", [r1.id]);
    expect(await f<{ applique: boolean }>("confirmer_complement($1, 'cs_test_surplus', 'evt-surplus-1', 'pi_complement_surplus', 1500, 'chf')", [r1.id])).toMatchObject({ applique: true });
    const r2 = await modifier(c, demande(`difference-${n}-surplus-2`, [ligne("Tiramisu", 800, 1, "cuisine")]));
    expect(r2).toMatchObject({ reglement: "remboursement", difference_centimes: -3500, rembourse_voulu_centimes: 3500, rembourse_centimes: 3500 });
    const rows = (await db.query<{ montant_centimes: number; payment_intent_cible: string | null }>("select montant_centimes, payment_intent_cible from remboursements where commande_id = $1 order by montant_centimes desc", [c])).rows;
    expect(rows).toEqual([
      { montant_centimes: 2000, payment_intent_cible: null },
      { montant_centimes: 1500, payment_intent_cible: "pi_complement_surplus" },
    ]);
    // Déjà rendu : plus rien à rembourser sur ce complément au refus de la commande.
    expect(await f<unknown[]>("complements_a_rembourser($1)", [c])).toEqual([]);
  });

  it("payée par carte au comptoir, moins chère : rendue sur le terminal par défaut, en espèces si l'équipe le choisit ; clôture et exports", async () => {
    const carte = await commande({ comptoir: true });
    await f("marquer_encaisse($1, 'tablette:Test', 'carte')", [carte]);
    const jour = (await db.query<{ j: string }>("select jour::text as j from commandes where id = $1", [carte])).rows[0].j;
    // La clôture compte un remboursement dans la journée de service où il est fait (de 5 h à 5 h, heure de Genève).
    const jourRendu = (await db.query<{ j: string }>("select ((now() at time zone 'Europe/Zurich') - interval '5 hours')::date::text as j")).rows[0].j;
    const avant = await f<{ encaissements: { terminal_rendu_centimes: number; attendu_carte_centimes: number } }>("cloture_rapport($1)", [jourRendu]);
    const r = await modifier(carte, demande(`difference-${n}-terminal-1`, [ligne("Margherita", 2000)]));
    expect(r.remboursement).toMatchObject({ montant_centimes: 800, moyen: "terminal", statut: "fait" });
    const j = (await db.query<{ apres: Record<string, unknown> }>("select apres from journal_gestion where objet = 'commande_modifiee' and cle = $1 order by id desc limit 1", [carte])).rows[0];
    expect(j.apres).toMatchObject({ moyen_remboursement: "terminal" });
    const apres = await f<{ encaissements: { terminal_rendu_centimes: number; attendu_carte_centimes: number } }>("cloture_rapport($1)", [jourRendu]);
    expect(apres.encaissements.terminal_rendu_centimes - avant.encaissements.terminal_rendu_centimes).toBe(800);
    expect(avant.encaissements.attendu_carte_centimes - apres.encaissements.attendu_carte_centimes).toBe(800);
    const recap = await f<{ rembourse_terminal_centimes: number }[]>("export_recap_jours($1, $2)", [jour < jourRendu ? jour : jourRendu, jour > jourRendu ? jour : jourRendu]);
    expect(recap.reduce((t, l) => t + Number(l.rembourse_terminal_centimes), 0)).toBeGreaterThanOrEqual(800);
    const cresus = await f<{ sorte: string; moyen: string; ttc_centimes: number }[]>("export_cresus($1, $2)", [jour < jourRendu ? jour : jourRendu, jour > jourRendu ? jour : jourRendu]);
    expect(cresus.some((l) => l.sorte === "remboursement" && l.moyen === "terminal")).toBe(true);

    // Le client préfère des espèces : l'équipe le choisit.
    const especes = await commande({ comptoir: true });
    await f("marquer_encaisse($1, 'tablette:Test', 'carte')", [especes]);
    const r2 = await modifier(especes, demande(`difference-${n}-terminal-2`, [ligne("Margherita", 2000)], { moyen_remboursement: "especes" }));
    expect(r2.remboursement).toMatchObject({ moyen: "especes" });
    const cheque = await commande({ comptoir: true });
    await f("marquer_encaisse($1, 'tablette:Test', 'carte')", [cheque]);
    expect(await erreur("preparer_modification($1, $2, $3)", [cheque, demande(`difference-${n}-terminal-3`, [ligne("Margherita", 2000)], { moyen_remboursement: "cheque" }), id.gerant])).toContain("moyen_invalide");
  });

  it("payée en ligne, complément encaissé à la porte, puis moins chère : Stripe d'abord, puis le complément rendu par l'équipe ; pas « remboursée » tant que des plats restent payés", async () => {
    const c = await commande({ mode: "livraison" });
    await modifier(c, demande(`difference-${n}-porte-rendu-1`, [ligne("Margherita", 2000, 2), ligne("Tiramisu", 800, 1, "cuisine")], { reglement: "porte" }));
    const k = (await db.query<{ id: string }>("select id from complements where commande_id = $1", [c])).rows[0].id;
    expect(await f<boolean>("encaisser_complement($1, 'carte', $2)", [k, id.gerant])).toBe(true);
    // Payé 2800 en ligne et 2000 par carte à la porte ; il ne garde que le tiramisu (800) : 4000 à rendre.
    const r = await modifier(c, demande(`difference-${n}-porte-rendu-2`, [ligne("Tiramisu", 800, 1, "cuisine")]));
    expect(r).toMatchObject({ rembourse_voulu_centimes: 4000, rembourse_centimes: 4000 });
    const rows = (await db.query<{ montant_centimes: number; moyen: string; statut: string; complement_id: string | null }>(
      "select montant_centimes, moyen, statut, complement_id::text from remboursements where commande_id = $1 order by montant_centimes desc", [c])).rows;
    expect(rows).toEqual([
      { montant_centimes: 2800, moyen: "stripe", statut: "en_cours", complement_id: null },
      { montant_centimes: 1200, moyen: "terminal", statut: "fait", complement_id: k },
    ]);
    expect((await db.query<{ s: string }>("select statut_paiement as s from commandes where id = $1", [c])).rows[0].s).toBe("paye");
    const j = (await db.query<{ apres: { remboursements: { moyen: string; centimes: number }[] } }>(
      "select apres from journal_gestion where objet = 'commande_modifiee' and cle = $1 order by id desc limit 1", [c])).rows[0].apres;
    expect(j.remboursements).toEqual([{ moyen: "stripe", centimes: 2800 }, { moyen: "terminal", centimes: 1200 }]);
    // Nouvelle baisse de 400 : le départ est déjà tout rendu, la suite sort du reste du complément (800), pas au-delà.
    const r2 = await modifier(c, demande(`difference-${n}-porte-rendu-3`, [ligne("Coca", 400, 1, "cuisine")]));
    expect(r2).toMatchObject({ rembourse_voulu_centimes: 400, rembourse_centimes: 400 });
    expect((await db.query<{ s: number }>("select sum(montant_centimes)::int as s from remboursements where commande_id = $1 and complement_id = $2", [c, k])).rows[0].s).toBe(1600);
    const r3 = await modifier(c, demande(`difference-${n}-porte-rendu-4`, [ligne("Eau", 100, 1, "cuisine")]));
    expect(r3).toMatchObject({ rembourse_voulu_centimes: 300, rembourse_centimes: 300 });
    expect((await db.query<{ s: number }>("select sum(montant_centimes)::int as s from remboursements where commande_id = $1 and complement_id = $2", [c, k])).rows[0].s).toBe(1900);
  });

  it("remboursement après coup d'une commande payée par carte au comptoir : sur le terminal", async () => {
    const c = await commande({ comptoir: true });
    await f("marquer_encaisse($1, 'tablette:Test', 'carte')", [c]);
    await f("changer_statut($1, 'prete', 'tablette:Test')", [c]);
    const r = await f<{ moyen: string; statut: string }>("demander_remboursement($1, 500, 'Pizza froide', $2, $3)", [c, `cle-terminal-${n}`, id.gerant]);
    expect(r).toMatchObject({ moyen: "terminal", statut: "fait" });
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
