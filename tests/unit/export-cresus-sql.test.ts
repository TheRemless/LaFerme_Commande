import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { ecrituresCresus, type LigneCresus, type PlanComptes } from "@/lib/export-cresus";
import type { RecapJour } from "@/lib/export-compta";

// Export Crésus, côté base : migration 20261214120000_export_cresus.sql.

let db: PGlite;
let n = 0;
const ids: Record<string, string> = {};

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

async function commande(jour: string, o: { total?: number; tva?: number; moyen?: string; comptoir?: string | null; paiement?: string; statut?: string; frais?: number } = {}) {
  n += 1;
  const total = o.total ?? 5000;
  return (
    await db.query<{ id: string }>(
      `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement, moyen_comptoir,
         client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement,
         sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine)
       values ($1, $2, $2, $3, $3, $4, $5, $6, $7, $8, 'Prénom', 'Nom', '079 000 00 00', 'client@laferme.test', 'asap', false,
         $9::integer - $10::integer, $10::integer, $9::integer, $11, 2.6, 'http://localhost:3000')
       returning id`,
      [n, jour, `cresus-${n}`, o.frais ? "livraison" : "retrait", o.statut ?? "terminee", o.paiement ?? "paye", o.moyen ?? "en_ligne", o.comptoir ?? null, total, o.frais ?? 0, o.tva ?? Math.round((total * 2.6) / 102.6)],
    )
  ).rows[0].id;
}

async function remboursement(commandeId: string, montant: number, moyen: string, le: string, statut = "fait") {
  n += 1;
  await db.query(
    `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le)
     values ($1, $2, $3, 'Manque', $4, $5, 'Giuseppe', $6::timestamptz, case when $5 = 'fait' then $6::timestamptz end)`,
    [commandeId, `cle-cresus-${n}`, montant, moyen, statut, le],
  );
}

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
  for (const [cle, role] of [["gerant", "gerant"], ["service", "service"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`cr-${cle}@laferme.test`, `Cr ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
});

const COMPTES = { caisse: "1000", stripe: "1090", terminal: "1091", tva: "2200", ventes: "3200", livraison: "3400", remboursements: "3800" };

describe("plan de comptes Crésus", () => {
  it("proposé au départ, marqué à confirmer", async () => {
    expect(await f<PlanComptes>("plan_comptes_cresus()")).toEqual({ confirme: false, comptes: COMPTES });
  });

  it("le gérant l'enregistre : confirmé, une ligne de journal par compte changé", async () => {
    const plan = await f<PlanComptes>("regler_plan_comptes_cresus($1::jsonb, $2)", [JSON.stringify({ ...COMPTES, ventes: "3000" }), ids.gerant]);
    expect(plan).toEqual({ confirme: true, comptes: { ...COMPTES, ventes: "3000" } });
    const j = await db.query<{ objet: string; cle: string; avant: unknown; apres: unknown }>("select objet, cle, avant, apres from journal_gestion where objet = 'plan_comptes'");
    expect(j.rows).toEqual([{ objet: "plan_comptes", cle: "ventes", avant: "3200", apres: "3000" }]);
  });

  it("refuse un employé, un rôle manquant ou en trop, un compte en lettres, deux rôles sur un compte", async () => {
    const regler = (p: unknown, qui = ids.gerant) => f("regler_plan_comptes_cresus($1::jsonb, $2)", [JSON.stringify(p), qui]);
    await expect(regler(COMPTES, ids.service)).rejects.toThrow(/Réservé au gérant/);
    await expect(regler({ ...COMPTES, ventes: undefined })).rejects.toThrow(/plan_invalide/);
    await expect(regler({ ...COMPTES, autre: "9" })).rejects.toThrow(/plan_invalide/);
    await expect(regler({ ...COMPTES, caisse: "10a0" })).rejects.toThrow(/compte_invalide:caisse/);
    await expect(regler({ ...COMPTES, caisse: 1000 })).rejects.toThrow(/compte_invalide:caisse/);
    await expect(regler({ ...COMPTES, terminal: "1090" })).rejects.toThrow(/compte_double/);
    expect((await f<PlanComptes>("plan_comptes_cresus()")).confirme).toBe(false);
  });

  it("illisible par les rôles du site", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select export_cresus('2026-12-01', '2026-12-31')")).rejects.toThrow(/permission denied/);
      await expect(db.query("select plan_comptes_cresus()")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
});

describe("export_cresus", () => {
  it("sépare en ligne, espèces et carte au comptoir ; un manque déduit sort du moyen de la commande", async () => {
    await commande("2026-12-04", { total: 5130, tva: 130, frais: 490 });
    await commande("2026-12-04", { total: 2052, tva: 52, moyen: "comptoir", comptoir: "especes", paiement: "encaisse" });
    const carte = await commande("2026-12-04", { total: 3078, tva: 78, moyen: "comptoir", comptoir: "carte", paiement: "encaisse" });
    await commande("2026-12-04", { total: 1026, tva: 26, moyen: "comptoir", comptoir: null, paiement: "encaisse" });
    await commande("2026-12-04", { statut: "refusee", paiement: "rembourse" });
    await remboursement(carte, 513, "deduction", "2026-12-04T19:00:00+01:00");
    const lignes = await f<LigneCresus[]>("export_cresus($1, $2)", ["2026-12-01", "2026-12-31"]);
    expect(lignes.map((l) => [l.sorte, l.moyen, l.nombre, l.ttc_centimes, l.tva_centimes, l.frais_centimes, l.tva_frais_centimes])).toEqual([
      ["vente", "caisse", 2, 3078, 78, 0, 0],
      ["vente", "stripe", 1, 5130, 130, 490, 12],
      ["vente", "terminal", 1, 3078, 78, 0, 0],
      ["remboursement", "terminal", 1, 513, 13, 0, 0],
    ]);
  });

  it("tombe juste avec le récapitulatif par jour, centime pour centime", async () => {
    const a = await commande("2026-12-04", { total: 5130, tva: 130, frais: 490 });
    await commande("2026-12-05", { total: 2052, tva: 52, moyen: "comptoir", comptoir: "especes", paiement: "encaisse" });
    await remboursement(a, 1026, "stripe", "2026-12-05T23:30:00+01:00");
    await remboursement(a, 2000, "stripe", "2026-12-06T10:00:00+01:00", "en_cours");
    // Commande modifiée (bo-commandes) : un complément payé par le lien et un encaissé à la porte, dont des frais.
    // Montants d'essai, comme les commandes ci-dessus.
    await db.query(
      `insert into complements (commande_id, montant_centimes, tva_centimes, frais_centimes, moyen, statut, moyen_encaissement, encaisse_le)
       values ($1, 1026, 26, 0, 'en_ligne', 'encaisse', 'stripe', now()), ($1, 513, 13, 500, 'porte', 'encaisse', 'especes', now()),
              ($1, 400, 10, 0, 'porte', 'a_encaisser', null, null)`,
      [a],
    );
    const recap = await f<RecapJour[]>("export_recap_jours($1, $2)", ["2026-12-01", "2026-12-31"]);
    const lignes = await f<LigneCresus[]>("export_cresus($1, $2)", ["2026-12-01", "2026-12-31"]);
    const r = ecrituresCresus(lignes, COMPTES);
    if (!r.ok) throw new Error(r.erreur);
    const somme = (pred: (e: { debit: string; credit: string }) => boolean) => r.ecritures.filter(pred).reduce((s, e) => s + e.centimes, 0);
    const ventesTtc = recap.reduce((s, l) => s + l.ttc_centimes, 0);
    const rembourse = recap.reduce((s, l) => s + l.rembourse_en_ligne_centimes + l.rembourse_especes_centimes + l.deduit_centimes, 0);
    const tvaNette = recap.reduce((s, l) => s + l.net_tva_centimes, 0);
    const moyens = [COMPTES.caisse, COMPTES.stripe, COMPTES.terminal];
    expect(somme((e) => moyens.includes(e.debit))).toBe(ventesTtc);
    expect(somme((e) => moyens.includes(e.credit))).toBe(rembourse);
    expect(somme((e) => e.credit === COMPTES.tva) - somme((e) => e.debit === COMPTES.tva)).toBe(tvaNette);
  });
});
