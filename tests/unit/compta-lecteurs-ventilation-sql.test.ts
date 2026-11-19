import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { RecapJour } from "@/lib/export-compta";
import { CONTREPARTIE, ecrituresCresus, ecrituresEtendues, type DonneesEtendues, type LigneCresus } from "@/lib/export-cresus";
import type { Remboursement, Vente } from "@/lib/gestion";

// R20 du plan docs/compta/plan-conformite.md : les lecteurs de la compta suivent la ventilation par taux
// (migration 20261217200000_compta_lecteurs_ventilation.sql). Commande à deux taux (pizza et bière), échange sans
// argent, avoir à parts signées. Aucun taux en dur : lus dans taux_tva.

let db: PGlite;
let gerant: string;
let pizza: string;
let normal: number;
let reduit: number;
let mixte: string;
const JOUR = "2026-12-04";

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const tva = (ttc: number, t: number) => Math.round((ttc * t) / (100 + t));

async function commande(lignes: { slug: string; total: number }[], cle: string): Promise<string> {
  const sous = lignes.reduce((s, l) => s + l.total, 0);
  const id = (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `j-${cle}`, cle_idempotence: cle, mode: "retrait", statut: "terminee", statut_paiement: "paye",
        moyen_paiement: "en_ligne", client_prenom: "T", client_nom: "V", client_telephone: "079", client_email: "r20@laferme.test",
        quand_type: "asap", pizzas_seulement: false, sous_total_centimes: sous, frais_centimes: 0, total_centimes: sous,
        tva_centimes: 1, taux_tva_pourcent: 0, origine: "http://localhost",
        lignes: lignes.map((l) => ({ slug: l.slug, nom: l.slug, station: "cuisine", qte: 1, unitaire_centimes: l.total, total_centimes: l.total, choix: {}, retraits: [], note: "", taux_tva_pourcent: 0 })),
      },
    ])
  ).rows[0].id;
  await db.query("update commandes set jour = $2, jour_service = $2 where id = $1", [id, JOUR]);
  return id;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('r20@laferme.test', 'R20', 'gerant') returning id")).rows[0].id;
  normal = Number(await f<string>("taux_tva_du('normal', $1::date)", [JOUR]));
  reduit = Number(await f<string>("taux_tva_du('reduit', $1::date)", [JOUR]));
  pizza = (await db.query<{ slug: string }>("select slug from plats where station = 'pizza' order by slug limit 1")).rows[0].slug;
  // Une bière à 5 % vol. : vendable puisque la compta à deux taux est prête (20261217200000).
  await db.query(
    "insert into plats (slug, categorie_id, nom, prix_centimes, station, commandable) select 'biere-r20', id, 'Bière', 500, 'comptoir', false from categories where slug = 'boissons'",
  );
  await f("regler_teneur_alcool('biere-r20', 5, $1)", [gerant]);
  mixte = await commande([{ slug: pizza, total: 2000 }, { slug: "biere-r20", total: 500 }], "r20-mixte");
});

describe("compta à deux taux prête", () => {
  it("le verrou de bo-carte est levé : une boisson alcoolisée peut être mise en vente", async () => {
    expect(await f<unknown>("(select valeur from reglages where cle = 'compta_multi_taux_pret')")).toBe(true);
    await db.query("update plats set commandable = true where slug = 'biere-r20'");
    expect(await f<boolean>("(select commandable from plats where slug = 'biere-r20')")).toBe(true);
  });
});

describe("commande à deux taux", () => {
  it("récap, export des ventes et synthèse : une ligne par taux, TVA de chaque taux, commande comptée une fois", async () => {
    const recap = await f<RecapJour[]>("export_recap_jours($1, $2)", [JOUR, JOUR]);
    expect(recap.map((l) => [Number(l.taux_tva_pourcent), l.ventes, l.ttc_centimes, l.tva_centimes])).toEqual([
      [reduit, 1, 2000, tva(2000, reduit)],
      [normal, 0, 500, tva(500, normal)],
    ]);
    const ventes = await f<Vente[]>("export_ventes($1, $2)", [JOUR, JOUR]);
    expect(ventes.map((v) => [Number(v.taux_tva_pourcent), v.total_centimes, v.premiere])).toEqual([
      [reduit, 2000, true],
      [normal, 500, false],
    ]);
    const s = await f<{ commandes: number; tva: { taux_pourcent: number; ttc_centimes: number; tva_centimes: number }[] }>("pilotage_synthese($1, $2)", [JOUR, JOUR]);
    expect(s.commandes).toBe(1);
    expect(s.tva.map((t) => [Number(t.taux_pourcent), t.ttc_centimes, t.tva_centimes])).toEqual([
      [reduit, 2000, tva(2000, reduit)],
      [normal, 500, tva(500, normal)],
    ]);
  });

  it("Crésus étendu : une écriture par taux, chacune équilibrée, TVA par code", async () => {
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [JOUR, JOUR]);
    const codes = { [reduit.toFixed(1)]: "RED", [normal.toFixed(1)]: "NOR" };
    const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
    const r = ecrituresEtendues(d, { comptes: COMPTES, codes_tva: codes });
    if (!r.ok) throw new Error(r.erreur);
    expect([...new Set(r.lignes.map((l) => l.code))].sort()).toEqual(["NOR", "RED"]);
    const tvaParCode = (code: string) => r.lignes.filter((l) => l.code === code && l.credit === COMPTES.tva).reduce((s, l) => s + l.centimes, 0);
    expect(tvaParCode("RED")).toBe(tva(2000, reduit));
    expect(tvaParCode("NOR")).toBe(tva(500, normal));
  });

  it("échange sans argent (pizza contre bière au même prix) : avoir et vente à sa date, TVA déplacée, rien au compte du moyen", async () => {
    const jourEchange = "2026-12-05";
    await db.query(
      `insert into modifications_commande (commande_id, cle, statut, reglement, lignes, sous_total_centimes, frais_centimes, total_centimes, tva_centimes,
         ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom, ventilation, fini_le)
       values ($1, 'echange-r20-0000001', 'appliquee', 'aucun', '[{"slug":"x"}]', 2500, 0, 2500, 0, 2500, 0, $2, 'R20', $3, $4::timestamptz)`,
      [mixte, gerant, JSON.stringify([{ taux: reduit, ttc: -500, tva: -tva(500, reduit) }, { taux: normal, ttc: 500, tva: tva(500, normal) }]), `${jourEchange}T12:00:00+01:00`],
    );
    const recap = await f<RecapJour[]>("export_recap_jours($1, $2)", [jourEchange, jourEchange]);
    expect(recap.map((l) => [Number(l.taux_tva_pourcent), l.ventes, l.ttc_centimes, l.en_ligne_centimes])).toEqual([
      [reduit, 0, -500, 0],
      [normal, 0, 500, 0],
    ]);
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [jourEchange, jourEchange]);
    expect(d.echanges).toHaveLength(1);
    const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
    const r = ecrituresEtendues(d, { comptes: COMPTES, codes_tva: { [reduit.toFixed(1)]: "RED", [normal.toFixed(1)]: "NOR" } });
    if (!r.ok) throw new Error(r.erreur);
    const net = (compte: string) => r.lignes.reduce((s, l) => s + (l.debit === compte ? l.centimes : 0) - (l.credit === compte ? l.centimes : 0), 0);
    expect(net(COMPTES.stripe)).toBe(0);
    expect(net(COMPTES.remboursements)).toBe(500 - tva(500, reduit));
    expect(-net(COMPTES.ventes)).toBe(500 - tva(500, normal));
    for (const m of new Set(r.lignes.map((l) => l.multiple))) {
      const lignes = r.lignes.filter((l) => l.multiple === m);
      expect(lignes.reduce((s, l) => s + (l.debit === CONTREPARTIE ? -1 : 1) * l.centimes, 0)).toBe(0);
    }
  });

  it("avoir à parts signées (baisse avec un article ajouté) : la part négative devient une vente", async () => {
    const jour = "2026-12-06";
    const m = (
      await db.query<{ id: string }>(
        `insert into modifications_commande (commande_id, cle, statut, reglement, lignes, sous_total_centimes, frais_centimes, total_centimes, tva_centimes,
           ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom, ventilation, fini_le)
         values ($1, 'baisse-r20-00000001', 'appliquee', 'remboursement', '[{"slug":"x"}]', 2000, 0, 2000, 0, 2500, -500, $2, 'R20', $3, $4::timestamptz)
         returning id`,
        [mixte, gerant, JSON.stringify([{ taux: reduit, ttc: -1000, tva: -tva(1000, reduit) }, { taux: normal, ttc: 500, tva: tva(500, normal) }]), `${jour}T12:00:00+01:00`],
      )
    ).rows[0].id;
    await db.query(
      `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le, modification_id)
       values ($1, 'remb-r20-baisse-01', 500, 'Commande modifiée', 'stripe', 'fait', 'R20', $2::timestamptz, $2::timestamptz, $3)`,
      [mixte, `${jour}T12:01:00+01:00`, m],
    );
    const ventes = await f<Remboursement[]>("export_remboursements($1, $2)", [jour, jour]);
    expect(ventes.map((x) => [Number(x.taux_tva_pourcent), x.montant_centimes])).toEqual([
      [reduit, 1000],
      [normal, -500],
    ]);
    const recap = await f<RecapJour[]>("export_recap_jours($1, $2)", [jour, jour]);
    expect(recap.reduce((s, l) => s + l.rembourse_en_ligne_centimes, 0)).toBe(500);
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [jour, jour]);
    const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
    const r = ecrituresEtendues(d, { comptes: COMPTES, codes_tva: { [reduit.toFixed(1)]: "RED", [normal.toFixed(1)]: "NOR" } });
    if (!r.ok) throw new Error(r.erreur);
    const net = (compte: string) => r.lignes.reduce((s, l) => s + (l.debit === compte ? l.centimes : 0) - (l.credit === compte ? l.centimes : 0), 0);
    expect(net(COMPTES.stripe)).toBe(-500);
    expect(net(COMPTES.remboursements)).toBe(1000 - tva(1000, reduit));
    expect(-net(COMPTES.ventes)).toBe(500 - tva(500, normal));
  });
});

describe("cas chiffrés de la relecture de #275 (client-compte, défauts 2 et 4)", () => {
  const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
  async function lignes(jour: string) {
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [jour, jour]);
    const r = ecrituresEtendues(d, { comptes: COMPTES, codes_tva: { [reduit.toFixed(1)]: "RED", [normal.toFixed(1)]: "NOR" } });
    if (!r.ok) throw new Error(r.erreur);
    return r.lignes;
  }
  const tvaDue = (l: Awaited<ReturnType<typeof lignes>>) => l.reduce((s, x) => s + (x.credit === COMPTES.tva ? x.centimes : 0) - (x.debit === COMPTES.tva ? x.centimes : 0), 0);

  it("pizza 18.50 échangée contre un vin 18.50 : la TVA déclarée passe de 47 à 139 centimes (+92)", async () => {
    const jour = "2026-12-08";
    const v = await commande([{ slug: pizza, total: 1850 }], "r20-vin");
    await db.query(
      `insert into modifications_commande (commande_id, cle, statut, reglement, lignes, sous_total_centimes, frais_centimes, total_centimes, tva_centimes,
         ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom, ventilation, fini_le)
       values ($1, 'echange-r20-vin-0001', 'appliquee', 'aucun', '[{"slug":"x"}]', 1850, 0, 1850, 0, 1850, 0, $2, 'R20', $3, $4::timestamptz)`,
      [v, gerant, JSON.stringify([{ taux: reduit, ttc: -1850, tva: -tva(1850, reduit) }, { taux: normal, ttc: 1850, tva: tva(1850, normal) }]), `${jour}T12:00:00+01:00`],
    );
    expect(tva(1850, reduit)).toBe(47);
    expect(tva(1850, normal)).toBe(139);
    expect(tvaDue(await lignes(jour))).toBe(139 - 47);
  });

  it("avoir de 31.00 : +37.00 rendus à 2,6 % et −6.00 vendus à 8,1 %, l'export ne s'arrête pas", async () => {
    const jour = "2026-12-09";
    const c = await commande([{ slug: pizza, total: 3700 }], "r20-avoir-signe");
    const m = (
      await db.query<{ id: string }>(
        `insert into modifications_commande (commande_id, cle, statut, reglement, lignes, sous_total_centimes, frais_centimes, total_centimes, tva_centimes,
           ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom, ventilation, fini_le)
         values ($1, 'baisse-r20-signe-001', 'appliquee', 'remboursement', '[{"slug":"x"}]', 600, 0, 600, 0, 3700, -3100, $2, 'R20', $3, $4::timestamptz)
         returning id`,
        [c, gerant, JSON.stringify([{ taux: reduit, ttc: -3700, tva: -tva(3700, reduit) }, { taux: normal, ttc: 600, tva: tva(600, normal) }]), `${jour}T12:00:00+01:00`],
      )
    ).rows[0].id;
    await db.query(
      `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le, modification_id)
       values ($1, 'remb-r20-signe-0001', 3100, 'Commande modifiée', 'stripe', 'fait', 'R20', $2::timestamptz, $2::timestamptz, $3)`,
      [c, `${jour}T12:01:00+01:00`, m],
    );
    const l = await lignes(jour);
    const net = (compte: string) => l.reduce((s, x) => s + (x.debit === compte ? x.centimes : 0) - (x.credit === compte ? x.centimes : 0), 0);
    expect(net(COMPTES.stripe)).toBe(-3100);
    expect(tvaDue(l)).toBe(tva(600, normal) - tva(3700, reduit));
  });
});

describe("relecture de #276 par client-compte (A, B, C)", () => {
  it("A et B : un échange sans argent sur une vente à un taux fait refuser le format simple, et la TVA du haut de la synthèse suit les taux", async () => {
    const jour = "2026-12-12";
    const v = await commande([{ slug: pizza, total: 1850 }], "r20-echange-simple");
    await db.query("update commandes set jour = $2, jour_service = $2 where id = $1", [v, jour]);
    await db.query(
      `insert into modifications_commande (commande_id, cle, statut, reglement, lignes, sous_total_centimes, frais_centimes, total_centimes, tva_centimes,
         ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom, ventilation, fini_le)
       values ($1, 'echange-r20-simple-01', 'appliquee', 'aucun', '[{"slug":"x"}]', 1850, 0, 1850, 0, 1850, 0, $2, 'R20', $3, $4::timestamptz)`,
      [v, gerant, JSON.stringify([{ taux: reduit, ttc: -1850, tva: -tva(1850, reduit) }, { taux: normal, ttc: 1850, tva: tva(1850, normal) }]), `${jour}T12:00:00+01:00`],
    );
    const lignes = await f<LigneCresus[]>("export_cresus($1, $2)", [jour, jour]);
    const r = ecrituresCresus(lignes, { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" });
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining("Plusieurs taux") });
    const s = await f<{ ttc_centimes: number; tva_centimes: number; ht_centimes: number; tva: { tva_centimes: number }[] }>("pilotage_synthese($1, $2)", [jour, jour]);
    expect(s.ttc_centimes).toBe(1850);
    expect(s.tva_centimes).toBe(tva(1850, normal));
    expect(s.tva_centimes).toBe(s.tva.reduce((x, t) => x + t.tva_centimes, 0));
    expect(s.ht_centimes).toBe(1850 - tva(1850, normal));
  });

  it("C : les frais d'un complément vont à sa part payée, et l'export des ventes les montre", async () => {
    const jour = "2026-12-13";
    const c = await commande([{ slug: "biere-r20", total: 1000 }], "r20-frais-complement");
    await db.query("update commandes set jour = $2, jour_service = $2 where id = $1", [c, jour]);
    // Bières remplacées par des pizzas, frais de 5.00 à 8.00 : complément de 3.00 de frais compris, parts +2300 à 2,6 %, −1000 à 8,1 %.
    await db.query(
      `insert into complements (commande_id, montant_centimes, tva_centimes, frais_centimes, moyen, statut, moyen_encaissement, encaisse_le, ventilation)
       values ($1, 1300, $2, 300, 'comptoir', 'encaisse', 'especes', now(), $3)`,
      [c, tva(2300, reduit) - tva(1000, normal), JSON.stringify([{ taux: reduit, ttc: 2300, tva: tva(2300, reduit) }, { taux: normal, ttc: -1000, tva: -tva(1000, normal) }])],
    );
    const ventes = await f<Vente[]>("export_ventes($1, $2)", [jour, jour]);
    const compl = ventes.filter((x) => x.paiement.includes("complément"));
    expect(compl.map((x) => [Number(x.taux_tva_pourcent), x.frais_centimes])).toEqual([
      [reduit, 300],
      [normal, 0],
    ]);
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [jour, jour]);
    expect(d.ventes.find((x) => Number(x.taux) === reduit && x.moyen === "caisse")?.frais_ttc).toBe(300);
  });
});

describe("tout rendre (remboursements.ventilation de #275, figée à la création)", () => {
  it("commande à deux taux rendue en deux fois : net 0 à chaque taux dans le récap, la synthèse et Crésus", async () => {
    const jour = "2026-12-11";
    const c = await commande([{ slug: pizza, total: 1850 }, { slug: "biere-r20", total: 650 }], "r20-tout-rendre");
    await db.query("update commandes set jour = $2, jour_service = $2 where id = $1", [c, jour]);
    for (const [cle, montant] of [["remb-r20-tout-01", 1000], ["remb-r20-tout-02", 1500]] as const) {
      await db.query(
        `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le)
         values ($1, $2, $3, 'Geste', 'stripe', 'fait', 'R20', $4::timestamptz, $4::timestamptz)`,
        [c, cle, montant, `${jour}T13:00:00+01:00`],
      );
    }
    const recap = await f<RecapJour[]>("export_recap_jours($1, $2)", [jour, jour]);
    expect(recap.map((l) => [Number(l.taux_tva_pourcent), l.net_ttc_centimes, l.net_tva_centimes])).toEqual([
      [reduit, 0, 0],
      [normal, 0, 0],
    ]);
    const s = await f<{ tva: { taux_pourcent: number; net_ttc_centimes: number; net_tva_centimes: number }[] }>("pilotage_synthese($1, $2)", [jour, jour]);
    expect(s.tva.map((t) => [Number(t.taux_pourcent), t.net_ttc_centimes, t.net_tva_centimes])).toEqual([
      [reduit, 0, 0],
      [normal, 0, 0],
    ]);
    const d = await f<DonneesEtendues>("export_cresus_etendu($1, $2)", [jour, jour]);
    const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800", rabais: "3801", cagnotte: "3802" };
    const r = ecrituresEtendues(d, { comptes: COMPTES, codes_tva: { [reduit.toFixed(1)]: "RED", [normal.toFixed(1)]: "NOR" } });
    if (!r.ok) throw new Error(r.erreur);
    for (const code of ["RED", "NOR"]) {
      const tvaNette = r.lignes.filter((l) => l.code === code).reduce((x, l) => x + (l.credit === COMPTES.tva ? l.centimes : 0) - (l.debit === COMPTES.tva ? l.centimes : 0), 0);
      expect(tvaNette).toBe(0);
    }
  });
});

describe("règles de TVA d'une commande à deux taux", () => {
  it("le gérant les change, journalisé ; une valeur inconnue ou un employé est refusé", async () => {
    expect(await f<unknown>("regles_tva()")).toEqual({ frais_tva_mixte: "normal", rabais_tva_mixte: "reduit_dabord" });
    expect(await f<string>("regler_regle_tva('frais_tva_mixte', 'prorata', $1)", [gerant])).toBe("prorata");
    const j = await db.query<{ cle: string; avant: unknown; apres: unknown }>("select cle, avant, apres from journal_gestion where objet = 'reglage' and cle = 'frais_tva_mixte'");
    expect(j.rows).toEqual([{ cle: "frais_tva_mixte", avant: "normal", apres: "prorata" }]);
    await expect(f("regler_regle_tva('frais_tva_mixte', 'tout_reduit', $1)", [gerant])).rejects.toThrow(/regle_invalide/);
    const employe = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('r20s@laferme.test', 'S', 'service') returning id")).rows[0].id;
    await expect(f("regler_regle_tva('frais_tva_mixte', 'normal', $1)", [employe])).rejects.toThrow(/Réservé au gérant/);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select regles_tva()")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
});
