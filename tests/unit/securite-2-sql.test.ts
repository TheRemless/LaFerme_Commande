import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { GET as photo } from "@/app/photos/[fichier]/route";

// Passe de sécurité finale (docs/audits/securite-2.md), migration 20261121090000_securite_2.sql :
// gestes du livreur limités à ses livraisons en cours (S2-05, S2-06), vues publiques en lecture seule (S2-08),
// photos sans paramètres (S2-11).

let db: PGlite;
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const id = async (email: string) => (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;

let n = 0;
async function livraison(statut = "acceptee", adresse = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }): Promise<string> {
  n += 1;
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-liv-${n}`,
      cle_idempotence: `liv-${n}`,
      mode: "livraison",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      client_prenom: `Client${n}`,
      client_nom: "Secret",
      client_telephone: "079 000 00 00",
      client_email: "liv@laferme.test",
      adresse,
      details_livraison: { etage: "3", sonnette: "Rossi", code: "4512", instructions: "Porte de gauche" },
      zone_numero: 1,
      quand_type: "asap",
      pizzas_seulement: false,
      sous_total_centimes: 3000,
      frais_centimes: 500,
      total_centimes: 3500,
      tva_centimes: 76,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [
        { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 1500, total_centimes: 3000, choix: {}, retraits: [], note: "" },
        { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
      ],
    },
  ]);
  const c = r.rows[0].id;
  await db.query("update commandes set statut = $2, heure_confirmee = now() + interval '30 minutes', stripe_payment_intent = 'pi_test' where id = $1", [c, statut]);
  return c;
}

const attribuer = (c: string, l: string) => f<string>("attribuer_livraison($1, $2, 'tablette:Test')", [c, l]);
const geste = (cle: string, l: string, c: string, g: string, motif: string | null = null, detail: string | null = null) =>
  f<{ ok: boolean; prevenir?: boolean; deja?: boolean; raison?: string }>("geste_livreur($1, $2, $3, $4, $5, $6)", [cle, l, c, g, motif, detail]);
const statut = async (c: string) => (await db.query<{ statut: string }>("select statut from commandes where id = $1", [c])).rows[0].statut;

let marco: string;
let ines: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  marco = await id("marco@laferme.test");
  ines = await id("ines@laferme.test");
});

const journal = async (c: string) =>
  (await db.query<{ evenement: string; par: string }>("select evenement, par from journal_livraisons where commande_id = $1 order by id", [c])).rows;

describe("S2-05 : « Compris » seulement sur une livraison du livreur", () => {
  it("Inès ne peut pas marquer « compris » la livraison de Marco, rien n'est écrit à son nom", async () => {
    const c = await livraison();
    expect(await attribuer(c, marco)).toBe("ok");
    expect(await geste("audit2-compris-0001", ines, c, "compris")).toEqual({ ok: false, raison: "pas_a_vous" });
    expect((await journal(c)).some((j) => j.par.includes("Inès"))).toBe(false);
  });

  it("un second « compris » avec une autre clé répond ok sans nouvelle ligne au journal", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await db.query("update commandes set statut = 'annulee' where id = $1", [c]);
    expect((await geste("audit2-compris-0002", marco, c, "compris")).ok).toBe(true);
    expect((await geste("audit2-compris-0003", marco, c, "compris")).ok).toBe(true);
    expect((await journal(c)).filter((j) => j.evenement === "compris")).toHaveLength(1);
  });
});

describe("S2-06 : aucun geste sur une livraison close", () => {
  it("après « Livrée », un problème est refusé et un « Livrée » rejoué n'ajoute rien au journal", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    expect((await geste("audit2-livree-0001", marco, c, "livree")).ok).toBe(true);
    expect(await statut(c)).toBe("terminee");
    expect(await geste("audit2-probleme-0001", marco, c, "probleme", "client_absent")).toEqual({ ok: false, raison: "statut" });
    expect((await geste("audit2-livree-0002", marco, c, "livree")).ok).toBe(true);
    const j = await journal(c);
    expect(j.filter((x) => x.evenement === "livree")).toHaveLength(1);
    expect(j.some((x) => x.evenement === "probleme")).toBe(false);
  });

  it("un problème sur une livraison en cours passe toujours", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    expect((await geste("audit2-partie-00001", marco, c, "partie")).ok).toBe(true);
    expect((await geste("audit2-probleme-0002", marco, c, "probleme", "client_absent")).ok).toBe(true);
  });
});

describe("S2-08 : vues publiques en lecture seule pour les visiteurs", () => {
  it("anon et authenticated lisent les quatre vues, sans aucun droit d'écriture", async () => {
    for (const v of ["carte_publique", "options_publiques", "plat_groupes_publics", "retraits_publics"]) {
      for (const role of ["anon", "authenticated"]) {
        const d = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
          "select has_table_privilege($1, $2, 'select') s, has_table_privilege($1, $2, 'insert') i, has_table_privilege($1, $2, 'update') u, has_table_privilege($1, $2, 'delete') d",
          [role, v],
        )).rows[0];
        expect(d, `${role} ${v}`).toEqual({ s: true, i: false, u: false, d: false });
      }
    }
  });
});

describe("S2-11 : une photo demandée avec des paramètres est refusée sans lire la base", () => {
  it("/photos/<id>.jpg?x=1 répond 404", async () => {
    const fichier = "5f36e417-d32e-4dd5-a068-ef80d230001d.jpg";
    const r = await photo(new Request(`http://localhost/photos/${fichier}?x=1`), { params: Promise.resolve({ fichier }) });
    expect(r.status).toBe(404);
  });
});
