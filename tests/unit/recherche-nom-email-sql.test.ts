import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-socle (relance du chef de produit gestion) : la recherche des commandes et des clients trouve le
// nom avant le prénom et le début d'un e-mail tapé sans @. Liste de Commandes, rubrique Clients et ⌘K partagent
// ces deux fonctions.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function commande(email: string, prenom: string, nom: string): Promise<number> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-rne-${n}`, cle_idempotence: `rne-${n}`, mode: "retrait", statut: "paiement_en_attente",
    statut_paiement: "en_attente", moyen_paiement: "en_ligne", client_prenom: prenom, client_nom: nom,
    client_telephone: "079 555 12 34", client_email: email, quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "x", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
  };
  const r = (await db.query<{ id: string; numero: number }>("select id, numero from creer_commande($1)", [p])).rows[0];
  await f("appliquer_paiement($1, $2, 'paye', 'pi_rne', 1000)", [`evt-${r.id}`, r.id]);
  return r.numero;
}
type Page = { lignes: Record<string, unknown>[] };
const commandes = async (recherche: string) => (await f<Page>("liste_commandes_gestion($1)", [{ recherche }])).lignes.map((l) => `${l.client_prenom} ${l.client_nom}`);
const clients = async (recherche: string) => (await f<Page>("clients_gestion($1)", [{ recherche }])).lignes.map((l) => l.email);

beforeAll(async () => {
  db = await creerBaseLocale();
  await commande("yanis.bonardi@exemple.ch", "Yanis", "Bonardi");
  await commande("yb_2@exemple.ch", "Yasmine", "Bon");
  await commande("marco@exemple.ch", "Marco", "Verdi");
});

describe("recherche par nom et par e-mail", () => {
  it("le nom avant le prénom trouve la même personne, dans les commandes et les clients", async () => {
    expect(await commandes("bonardi yanis")).toEqual(["Yanis Bonardi"]);
    expect(await commandes("Yanis  Bonardi")).toEqual(["Yanis Bonardi"]);
    expect(await clients("bonardi yanis")).toEqual(["yanis.bonardi@exemple.ch"]);
    // Chaque mot doit figurer : « verdi yanis » ne mélange pas deux clients.
    expect(await commandes("verdi yanis")).toEqual([]);
  });

  it("le début d'un e-mail sans @ trouve le client ; % et _ sont pris à la lettre", async () => {
    expect(await commandes("yanis.bon")).toEqual(["Yanis Bonardi"]);
    expect(await clients("yanis.bon")).toEqual(["yanis.bonardi@exemple.ch"]);
    expect(await clients("yb_2")).toEqual(["yb_2@exemple.ch"]);
    expect(await clients("y%")).toEqual([]);
    expect(await clients("ya_is")).toEqual([]);
  });

  it("un numéro de commande ne cherche pas dans les e-mails", async () => {
    const numero = await commande("123abc@exemple.ch", "Chiffre", "Test");
    const lignes = (await f<Page>("liste_commandes_gestion($1)", [{ recherche: String(numero) }])).lignes;
    expect(lignes.every((l) => l.numero === numero)).toBe(true);
  });

  it("filtre les commandes par état de remboursement", async () => {
    const id = (await db.query<{ id: string }>("select id from commandes where client_email = 'marco@exemple.ch'")).rows[0].id;
    await db.query(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom) values ($1, 'cle-rne-0001', 500, 'Froid.', 'stripe', 'echec', 'Gérant')",
      [id],
    );
    const echecs = (await f<Page>("liste_commandes_gestion($1)", [{ remboursement: "echec" }])).lignes.map((l) => l.client_nom);
    expect(echecs).toEqual(["Verdi"]);
    expect((await f<Page>("liste_commandes_gestion($1)", [{ remboursement: "fait" }])).lignes).toEqual([]);
  });
});
