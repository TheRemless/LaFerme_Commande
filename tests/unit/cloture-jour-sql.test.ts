import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { ClotureJour, RapportCloture } from "@/lib/cloture";

// Clôture du jour (migration 20261210190000_cloture_jour.sql). Commandes écrites directement ; horloge
// réglable comme dans tests/unit/gerant-correctifs-sql.test.ts.

let db: PGlite;
let n = 0;
let gerant: string;
let service: string;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}

type Commande = { jour: string; statut?: string; paiement?: string; moyen?: "en_ligne" | "comptoir"; total?: number; mode?: string };

async function commande(c: Commande): Promise<{ id: string; numero: number }> {
  n += 1;
  const total = c.total ?? 5000;
  const r = await db.query<{ id: string; numero: number }>(
    `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
       client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement,
       sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine, cree_le)
     values ($1, $2, $2, $3, $3, $4, $5, $6, $7, 'Prénom', 'Nom', '079 000 00 00', 'client@laferme.test', 'asap', false,
       $8::integer, 0, $8::integer, round($8::integer * 2.6 / 102.6), 2.6, 'http://localhost:3000', ($2::date + time '19:00') at time zone 'Europe/Zurich')
     returning id, numero`,
    [n, c.jour, `cloture-${n}`, c.mode ?? "retrait", c.statut ?? "terminee", c.paiement ?? "paye", c.moyen ?? "en_ligne", total],
  );
  return r.rows[0];
}

async function remboursement(commandeId: string, montant: number, moyen: string, statut: string, le: string) {
  n += 1;
  await db.query(
    `insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le, erreur)
     values ($1, $2, $3, 'Boisson manquante', $4, $5, 'Giuseppe', $6::timestamptz, case when $5 = 'fait' then $6::timestamptz end,
       case when $5 = 'echec' then 'carte expirée' end)`,
    [commandeId, `cle-cloture-${n}`, montant, moyen, statut, le],
  );
}

const rapport = (jour: string) => f<RapportCloture>("cloture_rapport($1::date)", [jour]);

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
  await horloge("2026-12-04T23:30:00Z"); // 0h30 le 5.12 à Genève : encore le jour de service du 4.12
});

describe("rapport du jour", () => {
  it("encaissements en ligne et au comptoir, attendu au comptoir net des déductions et des espèces rendues", async () => {
    await commande({ jour: "2026-12-04", total: 4000 });
    await commande({ jour: "2026-12-04", total: 3000, statut: "refusee", paiement: "rembourse" });
    const c1 = await commande({ jour: "2026-12-04", total: 2500, moyen: "comptoir", paiement: "encaisse" });
    const c2 = await commande({ jour: "2026-12-04", total: 1500, moyen: "comptoir", paiement: "encaisse" });
    await commande({ jour: "2026-12-03", total: 9900, moyen: "comptoir", paiement: "encaisse" });
    await remboursement(c1.id, 300, "deduction", "fait", "2026-12-04T18:30:00Z");
    await remboursement(c2.id, 200, "especes", "fait", "2026-12-04T19:30:00Z");

    const r = await rapport("2026-12-04");
    expect(r.encaissements).toMatchObject({
      en_ligne: { commandes: 1, centimes: 4000 },
      comptoir: { commandes: 2, centimes: 3700 },
      deductions_centimes: 300,
      especes_rendues_centimes: 200,
      attendu_comptoir_centimes: 3500,
    });
    expect(r.ventes.commandes).toBe(3);
    expect(r.ventes.tva[0].taux_pourcent).toBe(2.6);
  });

  it("liste le comptoir pas encore encaissé, les remboursements du jour de service et les écarts", async () => {
    const a = await commande({ jour: "2026-12-04", total: 2000, moyen: "comptoir", paiement: "a_encaisser_retrait", statut: "terminee" });
    const b = await commande({ jour: "2026-12-04", total: 1800, moyen: "comptoir", paiement: "a_encaisser_retrait", statut: "prete" });
    const c = await commande({ jour: "2026-12-04", total: 5000 });
    await remboursement(b.id, 300, "deduction", "fait", "2026-12-04T18:00:00Z");
    await remboursement(c.id, 700, "stripe", "echec", "2026-12-04T23:10:00Z"); // 0h10 le 5.12 : jour de service du 4.12
    await remboursement(c.id, 100, "stripe", "fait", "2026-12-04T03:00:00Z"); // 4h le 4.12 : jour de service du 3.12

    const r = await rapport("2026-12-04");
    expect(r.a_encaisser).toEqual([
      { numero: a.numero, mode: "retrait", statut: "terminee", du_centimes: 2000, heure: "19:00" },
      { numero: b.numero, mode: "retrait", statut: "prete", du_centimes: 1500, heure: "19:00" },
    ]);
    expect(r.remboursements.map((x) => [x.numero, x.moyen, x.statut, x.montant_centimes])).toEqual([
      [b.numero, "deduction", "fait", 300],
      [c.numero, "stripe", "echec", 700],
    ]);
    expect(r.remboursements[1]).toMatchObject({ erreur: "carte expirée", par: "Giuseppe", heure: "00:10" });
    expect(r.ecarts).toEqual([
      { type: "remise_sans_encaissement", numero: a.numero, centimes: 2000 },
      { type: "remboursement_echec", numero: c.numero, centimes: 700 },
      { type: "pas_terminee", numero: b.numero, statut: "prete", centimes: 1800 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Prénom|079|client@/);
  });
});

describe("espèces et carte au comptoir", () => {
  it("sépare ce que la tablette a noté, compte à part le non noté, sans faire croire qu'un jour clôturé a changé", async () => {
    const e1 = await commande({ jour: "2026-12-04", total: 2500, moyen: "comptoir", paiement: "encaisse" });
    const c1 = await commande({ jour: "2026-12-04", total: 4000, moyen: "comptoir", paiement: "encaisse" });
    await commande({ jour: "2026-12-04", total: 1000, moyen: "comptoir", paiement: "encaisse" });
    await db.query("update commandes set moyen_comptoir = 'especes' where id = $1", [e1.id]);
    await db.query("update commandes set moyen_comptoir = 'carte' where id = $1", [c1.id]);
    await remboursement(e1.id, 300, "especes", "fait", "2026-12-04T19:30:00Z");
    const r = await rapport("2026-12-04");
    expect(r.encaissements).toMatchObject({
      comptoir_especes: { commandes: 1, centimes: 2500 },
      comptoir_carte: { commandes: 1, centimes: 4000 },
      comptoir_non_note: { commandes: 1, centimes: 1000 },
      attendu_especes_centimes: 2200,
      attendu_carte_centimes: 4000,
      attendu_comptoir_centimes: 7200,
    });
    // Un rapport enregistré sans ces champs (clôture d'avant) ne passe pas pour « changé ».
    await f("cloturer_jour('2026-12-04', 2200, 4000, '', $1)", [gerant]);
    await db.query(`update clotures set rapport = jsonb_set(rapport, '{encaissements}',
      (rapport -> 'encaissements') - 'comptoir_especes' - 'comptoir_carte' - 'comptoir_non_note' - 'attendu_especes_centimes' - 'attendu_carte_centimes')
      where jour = '2026-12-04'`);
    expect((await f<ClotureJour>("cloture_jour('2026-12-04')")).change_depuis).toBe(false);
  });
});

describe("clôturer", () => {
  it("calcule l'écart avec ce qui a été compté, journalise, et une seconde clôture remplace la première", async () => {
    await commande({ jour: "2026-12-04", total: 2500, moyen: "comptoir", paiement: "encaisse" });
    const premiere = await f<ClotureJour["cloture"]>("cloturer_jour('2026-12-04', 2000, 0, ' Fond de  caisse ok ', $1)", [gerant]);
    expect(premiere).toMatchObject({ jour: "2026-12-04", attendu_comptoir_centimes: 2500, ecart_centimes: -500, note: "Fond de caisse ok", personnel_nom: expect.any(String) });

    const seconde = await f<ClotureJour["cloture"]>("cloturer_jour('2026-12-04', 2000, 500, '', $1)", [gerant]);
    expect(seconde).toMatchObject({ ecart_centimes: 0, carte_comptoir_centimes: 500 });

    const lu = await f<ClotureJour>("cloture_jour('2026-12-04')");
    expect(lu.cloture).toMatchObject({ ecart_centimes: 0 });
    expect(lu.cloture).not.toHaveProperty("personnel_id");
    expect(lu.cloture).not.toHaveProperty("rapport");
    expect(lu.change_depuis).toBe(false);
    expect(lu.rapport.jour).toBe("2026-12-04");

    const journal = (await db.query<{ objet: string; cle: string; avant: { ecart_centimes: number } | null; apres: Record<string, unknown> }>(
      "select objet, cle, avant, apres from journal_gestion where objet = 'cloture' order by id",
    )).rows;
    expect(journal).toHaveLength(2);
    expect(journal[0]).toMatchObject({ cle: "2026-12-04", avant: null });
    expect(journal[1].avant?.ecart_centimes).toBe(-500);
    expect(journal[1].apres).not.toHaveProperty("rapport");
  });

  it("sans montant compté, pas d'écart ; le rapport enregistré ne bouge plus ensuite", async () => {
    const c = await commande({ jour: "2026-12-04", total: 2500, moyen: "comptoir", paiement: "a_encaisser_retrait" });
    const cl = await f<ClotureJour["cloture"]>("cloturer_jour('2026-12-04', null, null, null, $1)", [gerant]);
    expect(cl?.ecart_centimes).toBeNull();
    await db.query("update commandes set statut_paiement = 'encaisse' where id = $1", [c.id]);
    const lu = await f<ClotureJour>("cloture_jour('2026-12-04')");
    expect(lu.rapport.encaissements.comptoir.centimes).toBe(0);
    expect(lu.change_depuis).toBe(true);
    expect((await f<ClotureJour>("cloture_rapport('2026-12-04')") as unknown as RapportCloture).encaissements.comptoir.centimes).toBe(2500);
  });

  it("réservé au gérant, refuse un jour à venir ou un montant négatif", async () => {
    await expect(f("cloturer_jour('2026-12-04', 0, 0, '', $1)", [service])).rejects.toThrow(/Réservé au gérant/);
    await expect(f("cloturer_jour('2026-12-05', 0, 0, '', $1)", [gerant])).rejects.toThrow(/jour_invalide/);
    await expect(f("cloturer_jour('2026-12-04', -1, 0, '', $1)", [gerant])).rejects.toThrow(/montant_invalide/);
  });

  it("une clôture ne s'annule pas depuis le journal", async () => {
    await f("cloturer_jour('2026-12-04', 0, 0, '', $1)", [gerant]);
    const id = (await db.query<{ id: number }>("select id from journal_gestion where objet = 'cloture'")).rows[0].id;
    await expect(f("annuler_journal($1, $2)", [id, gerant])).rejects.toThrow(/non_annulable/);
  });

  it("aucun droit pour un visiteur", async () => {
    for (const sql of ["select * from clotures", "select cloture_jour(current_date)"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
