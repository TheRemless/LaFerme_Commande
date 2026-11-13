import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { Synthese, TableauVentes } from "@/lib/pilotage";

// Tableau des ventes calculé en base (migration 20261129090000_pilotage_ventes.sql).
// Les commandes sont écrites directement : on vérifie le calcul, pas la prise de commande.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

type Commande = {
  jour: string;
  mode?: "livraison" | "retrait";
  statut?: string;
  paiement?: string;
  moyen?: "en_ligne" | "comptoir";
  total?: number;
  frais?: number;
  tva?: number;
  taux?: number;
  motif?: string | null;
};

async function commande(c: Commande): Promise<string> {
  n += 1;
  const total = c.total ?? 5000;
  const r = await db.query<{ id: string }>(
    `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
       client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement,
       sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine, motif, cree_le)
     values ($1, $2, $2, $3, $3, $4, $5, $6, $7, 'Prénom', 'Nom', '079 000 00 00', 'client@laferme.test', 'asap', false,
       $8, $9, $10, $11, $12, 'http://localhost:3000', $13, ($2::date + time '19:00') at time zone 'Europe/Zurich')
     returning id`,
    [
      n,
      c.jour,
      `pilotage-${n}`,
      c.mode ?? "retrait",
      c.statut ?? "terminee",
      c.paiement ?? "paye",
      c.moyen ?? "en_ligne",
      total - (c.frais ?? 0),
      c.frais ?? 0,
      total,
      c.tva ?? Math.round((total * 2.6) / 102.6),
      c.taux ?? 2.6,
      c.motif ?? null,
    ],
  );
  return r.rows[0].id;
}

async function remboursement(commandeId: string, montant: number, statut: "fait" | "en_cours" | "echec", le: string, moyen = "stripe") {
  n += 1;
  await db.query(
    `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le)
     values ($1, $2, $3, 'Geste test', $4, $5, 'Test', $6::timestamptz, case when $5 = 'fait' then $6::timestamptz end)`,
    [commandeId, `cle-pilotage-${n}`, montant, moyen, statut, le],
  );
}

const ventes = (debut: string, fin: string) => f<TableauVentes>("pilotage_ventes($1::date, $2::date)", [debut, fin]);

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
});

describe("synthèse des ventes d'une période", () => {
  it("compte les commandes prises, encaissées ou à encaisser, sans les refusées ni les paiements en attente", async () => {
    await commande({ jour: "2026-12-04", total: 5000, tva: 127 });
    await commande({ jour: "2026-12-04", total: 3000, tva: 76, mode: "livraison", frais: 490 });
    await commande({ jour: "2026-12-04", total: 2000, tva: 51, moyen: "comptoir", paiement: "a_encaisser_retrait", statut: "prete" });
    await commande({ jour: "2026-12-04", total: 1500, tva: 38, moyen: "comptoir", paiement: "encaisse" });
    await commande({ jour: "2026-12-04", total: 9900, statut: "refusee", motif: "Plus de pâte" });
    await commande({ jour: "2026-12-04", total: 9900, statut: "paiement_en_attente", paiement: "en_attente" });
    await commande({ jour: "2026-12-04", total: 9900, statut: "annulee", paiement: "echec" });
    await commande({ jour: "2026-12-05", total: 7000 });

    const p = (await ventes("2026-12-04", "2026-12-04")).periode;
    expect(p).toMatchObject({
      debut: "2026-12-04",
      fin: "2026-12-04",
      commandes: 4,
      ttc_centimes: 11500,
      tva_centimes: 292,
      ht_centimes: 11208,
      panier_moyen_centimes: 2875,
      encaisse_centimes: 9500,
      a_encaisser: 1,
      a_encaisser_centimes: 2000,
      frais_centimes: 490,
      livraison: { commandes: 1, ttc_centimes: 3000 },
      retrait: { commandes: 3, ttc_centimes: 8500 },
      en_ligne: { commandes: 2, ttc_centimes: 8000 },
      comptoir: { commandes: 2, ttc_centimes: 3500 },
      net_ttc_centimes: 11500,
    });
    expect(p.refusees).toEqual({ commandes: 1, ttc_centimes: 9900, motifs: [{ motif: "Plus de pâte", commandes: 1, ttc_centimes: 9900 }] });
  });

  it("regroupe les motifs de refus sans tenir compte des majuscules, les plus fréquents d'abord", async () => {
    for (const motif of ["Trop de monde", "trop de monde", " Trop de monde ", "Adresse hors zone", ""]) {
      await commande({ jour: "2026-12-04", statut: "refusee", motif, total: 1000 });
    }
    const motifs = (await ventes("2026-12-04", "2026-12-04")).periode.refusees.motifs;
    expect(motifs.map((m) => [m.motif.toLowerCase(), m.commandes])).toEqual([
      ["trop de monde", 3],
      ["adresse hors zone", 1],
      ["sans motif", 1],
    ]);
  });

  it("déduit les remboursements faits au jour du remboursement, heure de Genève, sans ceux d'une commande refusée", async () => {
    const a = await commande({ jour: "2026-12-01", total: 6000 });
    const b = await commande({ jour: "2026-12-04", total: 4000, moyen: "comptoir", paiement: "encaisse" });
    const refusee = await commande({ jour: "2026-12-04", total: 3000, statut: "refusee", motif: "Fermé", paiement: "rembourse" });
    // 4.12 à 00h30 à Genève = 3.12 à 23h30 UTC : compte le 4.12.
    await remboursement(a, 1000, "fait", "2026-12-03T23:30:00Z");
    await remboursement(b, 500, "fait", "2026-12-04T19:00:00Z", "especes");
    await remboursement(refusee, 3000, "fait", "2026-12-04T19:05:00Z");
    // 4.12 à 23h30 UTC = 5.12 à Genève : hors période.
    await remboursement(a, 200, "fait", "2026-12-04T23:30:00Z");
    await remboursement(b, 300, "en_cours", "2026-12-04T20:00:00Z");
    await remboursement(refusee, 700, "echec", "2026-12-04T20:00:00Z");

    const p = (await ventes("2026-12-04", "2026-12-04")).periode;
    expect(p.remboursements).toEqual({
      faits: 2,
      faits_centimes: 1500,
      faits_en_ligne_centimes: 1000,
      faits_especes_centimes: 500,
      en_cours: 1,
      en_cours_centimes: 300,
      echecs: 1,
      echecs_centimes: 700,
      echecs_ouverts: 1,
      echecs_ouverts_centimes: 700,
    });
    // Un échec du 4.12 reste visible le lendemain tant qu'il n'est pas réglé.
    expect((await ventes("2026-12-05", "2026-12-05")).periode.remboursements).toMatchObject({ echecs: 0, echecs_ouverts: 1 });
    // Seule la commande b est du 4.12 (a est du 1.12, la refusée ne compte pas).
    expect(p.ttc_centimes).toBe(4000);
    expect(p.net_ttc_centimes).toBe(2500);
  });

  it("donne la TVA par taux, ventes et remboursements, en net", async () => {
    const a = await commande({ jour: "2026-12-04", total: 10260, tva: 260, taux: 2.6 });
    await commande({ jour: "2026-12-04", total: 10810, tva: 810, taux: 8.1 });
    await remboursement(a, 1026, "fait", "2026-12-04T18:00:00Z");
    const tva = (await ventes("2026-12-04", "2026-12-04")).periode.tva;
    expect(tva).toEqual([
      {
        taux_pourcent: 2.6,
        ttc_centimes: 10260,
        tva_centimes: 260,
        ht_centimes: 10000,
        rembourse_centimes: 1026,
        tva_remboursee_centimes: 26,
        net_ttc_centimes: 9234,
        net_tva_centimes: 234,
        net_ht_centimes: 9000,
      },
      {
        taux_pourcent: 8.1,
        ttc_centimes: 10810,
        tva_centimes: 810,
        ht_centimes: 10000,
        rembourse_centimes: 0,
        tva_remboursee_centimes: 0,
        net_ttc_centimes: 10810,
        net_tva_centimes: 810,
        net_ht_centimes: 10000,
      },
    ]);
  });

  it("une période sans commande rend des zéros, pas des vides", async () => {
    const p: Synthese = (await ventes("2026-12-04", "2026-12-06")).periode;
    expect(p).toMatchObject({ commandes: 0, ttc_centimes: 0, panier_moyen_centimes: 0, net_ttc_centimes: 0, tva: [] });
    expect(p.refusees).toEqual({ commandes: 0, ttc_centimes: 0, motifs: [] });
    expect(p.remboursements.faits).toBe(0);
  });
});

describe("comparaison et jours", () => {
  it("compare un jour au même jour de la semaine précédente, un mois à la même durée juste avant", async () => {
    await commande({ jour: "2026-12-04", total: 5000 });
    await commande({ jour: "2026-11-27", total: 3000 });
    await commande({ jour: "2026-12-03", total: 9999 });
    const jour = await ventes("2026-12-04", "2026-12-04");
    expect(jour.comparaison).toMatchObject({ debut: "2026-11-27", fin: "2026-11-27", commandes: 1, ttc_centimes: 3000 });

    const semaine = await ventes("2026-11-30", "2026-12-06");
    expect(semaine.comparaison).toMatchObject({ debut: "2026-11-23", fin: "2026-11-29", ttc_centimes: 3000 });

    const choisie = await f<TableauVentes>("pilotage_ventes('2026-12-01', '2026-12-31', '2026-11-01', '2026-11-30')");
    expect(choisie.comparaison).toMatchObject({ debut: "2026-11-01", fin: "2026-11-30", commandes: 1 });
  });

  it("donne chaque jour de la période, jours vides compris", async () => {
    await commande({ jour: "2026-12-04", total: 5000 });
    await commande({ jour: "2026-12-04", total: 2000, statut: "refusee", motif: "Fermé" });
    await commande({ jour: "2026-12-06", total: 3000 });
    const jours = (await ventes("2026-12-04", "2026-12-06")).jours;
    expect(jours).toEqual([
      { jour: "2026-12-04", commandes: 1, ttc_centimes: 5000, refusees: 1 },
      { jour: "2026-12-05", commandes: 0, ttc_centimes: 0, refusees: 0 },
      { jour: "2026-12-06", commandes: 1, ttc_centimes: 3000, refusees: 0 },
    ]);
  });

  it("refuse une période à l'envers, de plus d'un an ou une comparaison à moitié donnée", async () => {
    await expect(ventes("2026-12-05", "2026-12-04")).rejects.toThrow(/Période invalide/);
    await expect(ventes("2025-01-01", "2026-12-31")).rejects.toThrow(/Période invalide/);
    await expect(f("pilotage_ventes('2026-12-01', '2026-12-31', '2026-11-01', null)")).rejects.toThrow(/Période invalide/);
  });
});

describe("droits", () => {
  it("aucun droit pour un visiteur ni un client connecté", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query("select pilotage_ventes(current_date, current_date)");
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
