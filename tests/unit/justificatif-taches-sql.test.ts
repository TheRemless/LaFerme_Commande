import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Deux tickets pour le même poste (préparation et justificatif du client, migration 20261217160000) : une
// réimpression les crée tous les deux, sauf si le poste avait déjà une tâche en attente avant l'appel.

let db: PGlite;
let commande: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: "jeton-justif-1", cle_idempotence: "justif-1", mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir", client_prenom: "Léa", client_nom: "Test", client_telephone: "079 000 00 00", client_email: "j@laferme.test",
      quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 1800, frais_centimes: 0, total_centimes: 1800, tva_centimes: 46,
      taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
      lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
    },
  ]);
  commande = r.rows[0].id;
});
const deux = [
  { station: "cuisine", contenu: [{ t: "texte", texte: "CUISINE" }] },
  { station: "cuisine", contenu: [{ t: "texte", texte: "JUSTIFICATIF CLIENT" }] },
];
const creer = (reimpression: boolean) => db.query<{ n: number }>("select creer_taches_impression($1, $2, $3) as n", [commande, JSON.stringify(deux), reimpression]);
const taches = async () => (await db.query<{ n: number }>("select count(*)::int as n from taches_impression where commande_id = $1", [commande])).rows[0].n;

describe("tâches d'impression, deux tickets au même poste", () => {
  it("premiers tickets et réimpression d'un poste libre : les deux tickets", async () => {
    expect((await creer(true)).rows[0].n).toBe(2);
    expect(await taches()).toBe(2);
  });

  it("réimpression d'un poste qui a déjà une tâche en attente : rien de plus", async () => {
    await creer(false);
    // Imprimante branchée : les tâches attendent leur envoi.
    await db.query("update taches_impression set etat = 'en_attente' where commande_id = $1", [commande]);
    expect((await creer(true)).rows[0].n).toBe(0);
    expect(await taches()).toBe(2);
  });
});

describe("« Ticket » à la tablette", () => {
  it("les deux tickets de la dernière impression du poste, préparation d'abord", async () => {
    await creer(false);
    const t = (await db.query<{ r: { station: string; contenu: { texte: string }[] }[] }>("select tickets_commande($1) as r", [commande])).rows[0].r;
    expect(t.map((x) => x.contenu[0].texte)).toEqual(["CUISINE", "JUSTIFICATIF CLIENT"]);
  });
});
