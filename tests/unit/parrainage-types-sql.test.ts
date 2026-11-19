import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Crédit du parrain et crédit du filleul sur deux types distincts (R28 et R29 du plan de conformité compta,
// migration 20261217100000_parrainage_types.sql), pour que la fiduciaire puisse les traiter différemment.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function compte(email: string): Promise<string> {
  return (await db.query<{ id: string }>("insert into comptes (email, prenom, nom, telephone) values ($1, 'Léa', 'Test', '') returning id", [email])).rows[0].id;
}
async function commande(compteId: string, email: string, telephone: string, numero: string): Promise<string> {
  n += 1;
  const id = (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `jeton-types-${n}`,
        cle_idempotence: `types-${n}`,
        mode: "livraison",
        statut: "nouvelle",
        statut_paiement: "paye",
        moyen_paiement: "en_ligne",
        client_prenom: "Léa",
        client_nom: `Nom${n}`,
        client_telephone: telephone,
        client_email: email,
        adresse: { rue: "Route de Chancy", numero, npa: "1213", localite: "Onex" },
        zone_numero: 1,
        quand_type: "asap",
        pizzas_seulement: true,
        sous_total_centimes: 4000,
        frais_centimes: 500,
        total_centimes: 4500,
        tva_centimes: 0,
        taux_tva_pourcent: 2.6,
        origine: "http://localhost:3000",
        compte_id: compteId,
        lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 4000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
      },
    ])
  ).rows[0].id;
  await db.query("update commandes set statut = 'terminee' where id = $1", [id]);
  return id;
}
type Mouvement = { compte_id: string; type: string; montant_centimes: number; commande_id: string };
const mouvements = async () =>
  (await db.query<Mouvement>("select compte_id, type, montant_centimes, commande_id from cagnotte_mouvements where type like 'parrainage%' order by id")).rows;

let parrain: string;
let filleul: string;
let declenche: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  parrain = await compte("parrain@exemple.ch");
  await commande(parrain, "parrain@exemple.ch", "079 111 11 11", "10");
  const code = await f<string>("code_parrainage($1)", [parrain]);
  filleul = await compte("filleul@exemple.ch");
  expect(await f<string>("lier_parrainage('filleul@exemple.ch', $1)", [code])).toBe("ok");
  declenche = await commande(filleul, "filleul@exemple.ch", "079 222 22 22", "20");
});

describe("types de mouvement du parrainage", () => {
  it("le crédit du parrain et celui du filleul ont chacun leur type, liés à la commande du filleul", async () => {
    expect(await mouvements()).toEqual([
      { compte_id: parrain, type: "parrainage_parrain", montant_centimes: 1000, commande_id: declenche },
      { compte_id: filleul, type: "parrainage_filleul", montant_centimes: 1000, commande_id: declenche },
    ]);
    // Le lien parrain et filleul reste dans parrainages, avec la commande qui a déclenché le crédit.
    const p = (await db.query<{ parrain_id: string; filleul_id: string; commande_id: string }>("select parrain_id, filleul_id, commande_id from parrainages")).rows;
    expect(p).toEqual([{ parrain_id: parrain, filleul_id: filleul, commande_id: declenche }]);
  });

  it("la reprise au remboursement garde le type de chaque crédit", async () => {
    await db.query(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, 'remb-types', 4500, 'Erreur', 'stripe', 'fait', 'Test', now())",
      [declenche],
    );
    const repris = (await mouvements()).filter((m) => m.montant_centimes < 0);
    expect(repris.map((m) => [m.compte_id, m.type, m.montant_centimes]).sort()).toEqual(
      [
        [parrain, "parrainage_parrain", -1000],
        [filleul, "parrainage_filleul", -1000],
      ].sort(),
    );
  });

  it("l'ancien type « parrainage » est refusé ; les mouvements déjà écrits sont convertis par la migration", async () => {
    await expect(db.query("insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif) values ($1, 'parrainage', 100, 'x')", [parrain])).rejects.toThrow();
    // Base d'avant la migration : les deux crédits sous l'ancien type.
    await db.exec(`
      alter table cagnotte_mouvements drop constraint cagnotte_mouvements_type_check;
      update cagnotte_mouvements set type = 'parrainage' where type like 'parrainage%';
      alter table cagnotte_mouvements add constraint cagnotte_mouvements_type_check
        check (type in ('gain', 'utilise', 'rendu', 'retrait', 'expire', 'ajustement', 'parrainage'));`);
    const sql = await readFile("supabase/migrations/20261217100000_parrainage_types.sql", "utf8");
    await db.exec(sql.slice(sql.indexOf("alter table cagnotte_mouvements drop constraint"), sql.indexOf("create or replace function")));
    expect((await mouvements()).map((m) => [m.compte_id, m.type])).toEqual([
      [parrain, "parrainage_parrain"],
      [filleul, "parrainage_filleul"],
    ]);
  });

  it("l'écran Parrainages et l'alerte « reçu plus que payé » lisent les nouveaux types", async () => {
    const liste = await f<{ parrain_id: string; filleuls: { montant_centimes: number }[] }[]>("parrainages_gestion()");
    expect(liste.find((x) => x.parrain_id === parrain)!.filleuls.map((x) => x.montant_centimes)).toEqual([1000]);
    // Le filleul a reçu CHF 10 et payé CHF 45 : rien. Avec CHF 50 reçus en plus comme parrain, l'alerte part.
    await db.query("insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif) values ($1, $2, 'parrainage_parrain', 5000, 'Parrainage d''un proche')", [filleul, declenche]);
    await db.query("update surveillance_etat set parrainage_detecte_le = null where id");
    const cas = await f<{ type: string; compte_id: string }[]>("detecter_alertes_parrainage()");
    expect(cas.filter((c) => c.type === "recu_plus_que_paye" && c.compte_id === filleul)).toHaveLength(1);
  });
});
