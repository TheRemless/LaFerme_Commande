import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { csvRecapJours, type RecapJour, type RemboursementASuivre } from "@/lib/export-compta";
import type { Remboursement, Vente } from "@/lib/gestion";

// Export pour la fiduciaire par jour et par taux, et remboursements à suivre
// (migration 20261129120000_export_compta.sql).

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}

async function commande(jour: string, o: { total?: number; tva?: number; taux?: number; moyen?: string; paiement?: string; statut?: string; frais?: number } = {}) {
  n += 1;
  const total = o.total ?? 5000;
  return (
    await db.query<{ id: string }>(
      `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
         client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement,
         sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine)
       values ($1, $2, $2, $3, $3, $4, $5, $6, $7, 'Prénom', 'Nom', '079 000 00 00', 'client@laferme.test', 'asap', false,
         $8::integer - $9::integer, $9::integer, $8::integer, $10, $11, 'http://localhost:3000')
       returning id`,
      [n, jour, `compta-${n}`, o.frais ? "livraison" : "retrait", o.statut ?? "terminee", o.paiement ?? "paye", o.moyen ?? "en_ligne", total, o.frais ?? 0, o.tva ?? Math.round((total * 2.6) / 102.6), o.taux ?? 2.6],
    )
  ).rows[0].id;
}

async function remboursement(commandeId: string, montant: number, moyen: string, statut: string, le: string) {
  n += 1;
  await db.query(
    `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le)
     values ($1, $2, $3, 'Manque', $4, $5, 'Giuseppe', $6::timestamptz, case when $5 = 'fait' then $6::timestamptz end)`,
    [commandeId, `cle-compta-${n}`, montant, moyen, statut, le],
  );
}

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
});

describe("récapitulatif par jour et par taux", () => {
  it("additionne ventes et remboursements comme le détail de l'export, centime pour centime", async () => {
    const a = await commande("2026-12-04", { total: 5130, tva: 130, frais: 490 });
    await commande("2026-12-04", { total: 2052, tva: 52, moyen: "comptoir", paiement: "encaisse" });
    const c = await commande("2026-12-04", { total: 10810, tva: 810, taux: 8.1 });
    await commande("2026-12-04", { total: 9999, statut: "refusee", paiement: "rembourse" });
    await commande("2026-12-04", { total: 9999, moyen: "comptoir", paiement: "a_encaisser_retrait", statut: "prete" });
    await commande("2026-12-05", { total: 3000 });
    await remboursement(a, 513, "stripe", "fait", "2026-12-04T19:00:00Z");
    await remboursement(c, 1081, "especes", "fait", "2026-12-05T10:00:00Z");
    await remboursement(a, 100, "stripe", "en_cours", "2026-12-04T19:30:00Z");

    const recap = await f<RecapJour[]>("export_recap_jours('2026-12-04', '2026-12-05')");
    expect(recap.map((l) => [l.jour, l.taux_tva_pourcent, l.ventes, l.ttc_centimes, l.net_ttc_centimes, l.net_tva_centimes])).toEqual([
      ["2026-12-04", 2.6, 2, 7182, 6669, 169],
      ["2026-12-04", 8.1, 1, 10810, 10810, 810],
      ["2026-12-05", 2.6, 1, 3000, 3000, 76],
      ["2026-12-05", 8.1, 0, 0, -1081, -81],
    ]);
    expect(recap[0]).toMatchObject({ en_ligne_centimes: 5130, comptoir_centimes: 2052, frais_centimes: 490, rembourse_en_ligne_centimes: 513, tva_remboursee_centimes: 13 });

    // Mêmes totaux que le détail (export_ventes et export_remboursements).
    const ventes = await f<Vente[]>("export_ventes('2026-12-04', '2026-12-05')");
    const rembs = await f<Remboursement[]>("export_remboursements('2026-12-04', '2026-12-05')");
    const net = ventes.reduce((s, v) => s + v.total_centimes, 0) - rembs.reduce((s, r) => s + r.montant_centimes, 0);
    const tva = ventes.reduce((s, v) => s + v.tva_centimes, 0) - rembs.reduce((s, r) => s + r.tva_centimes, 0);
    expect(recap.reduce((s, l) => s + l.net_ttc_centimes, 0)).toBe(net);
    expect(recap.reduce((s, l) => s + l.net_tva_centimes, 0)).toBe(tva);
  });

  it("CSV : une ligne par jour et par taux, remboursements en négatif, total par taux, sans donnée de client", async () => {
    const a = await commande("2026-12-04", { total: 5130, tva: 130 });
    await commande("2026-12-05", { total: 2052, tva: 52 });
    await remboursement(a, 513, "stripe", "fait", "2026-12-04T19:00:00Z");
    const csv = csvRecapJours(await f<RecapJour[]>("export_recap_jours('2026-12-04', '2026-12-05')"));
    const lignes = csv.replace("﻿", "").trim().split("\r\n");
    expect(lignes[0]).toMatch(/^Jour;Taux TVA %;Ventes;En ligne CHF/);
    expect(lignes[1]).toBe("2026-12-04;2.6;1;51.30;0.00;0.00;51.30;1.30;-5.13;0.00;0.00;-0.13;46.17;1.17;45.00");
    expect(lignes.at(-1)).toBe("Total;2.6;2;71.82;0.00;0.00;71.82;1.82;-5.13;0.00;0.00;-0.13;66.69;1.69;65.00");
    expect(csv).not.toMatch(/Prénom|079|client@/);
  });
});

describe("remboursements à suivre", () => {
  it("les échecs, et ceux que Stripe n'a pas confirmés depuis plus de 24 heures, les plus anciens d'abord", async () => {
    await horloge("2026-12-05T20:00:00Z");
    const a = await commande("2026-12-03");
    await remboursement(a, 300, "stripe", "echec", "2026-12-04T19:00:00Z");
    await remboursement(a, 400, "stripe", "en_cours", "2026-12-03T19:00:00Z");
    await remboursement(a, 500, "stripe", "en_cours", "2026-12-05T19:00:00Z"); // il y a une heure : encore normal
    await remboursement(a, 600, "stripe", "fait", "2026-12-03T19:00:00Z");
    const liste = await f<RemboursementASuivre[]>("remboursements_a_suivre(24)");
    expect(liste.map((r) => [r.statut, r.montant_centimes])).toEqual([
      ["en_cours", 400],
      ["echec", 300],
    ]);
    expect(liste[0]).toMatchObject({ commande_id: a, par: "Giuseppe", commande_refusee: false });
    expect(JSON.stringify(liste)).not.toMatch(/Prénom|079|client@/);
  });

  it("aucun droit pour un visiteur", async () => {
    for (const sql of ["select export_recap_jours(current_date, current_date)", "select remboursements_a_suivre(24)"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
