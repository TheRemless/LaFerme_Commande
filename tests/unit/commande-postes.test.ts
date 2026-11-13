import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Horodatage par poste (vague 3, tablette ; accords bo-pilotage et bo-operations) : lignes créées aux premiers
// tickets, a_faire_le fixé une fois, « Prête » au poste ou déduite du statut, gestes de l'équipe seulement.

let db: PGlite;
let equipe: string;
let livreur: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  equipe = (await db.query<{ id: string }>("select id from personnel where role = 'service' and actif limit 1")).rows[0].id;
  livreur = (await db.query<{ id: string }>("select id from personnel where role = 'livreur' and actif limit 1")).rows[0].id;
});
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}
type Poste = { station: string; a_faire_le: string; lance_le: string | null; pret_le: string | null; pret_par: string | null };
const postes = async (id: string) =>
  (await db.query<Poste>("select station, a_faire_le::text, lance_le::text, pret_le::text, pret_par from commande_postes where commande_id = $1 order by station", [id])).rows;

let n = 0;
async function commande(stations: ("pizza" | "cuisine")[]): Promise<string> {
  n += 1;
  const ligne = (station: string) => ({ slug: `plat-${station}`, nom: `Plat ${station}`, station, qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" });
  return (await db.query<{ id: string }>("select * from creer_commande($1)", [{
    jeton_suivi: `j-cp-${n}`, cle_idempotence: `cp-${n}`, mode: "retrait", statut: "acceptee", statut_paiement: "paye", moyen_paiement: "en_ligne",
    client_prenom: "A", client_nom: "B", client_telephone: "079", client_email: "a@b.test", quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: 1000 * stations.length, frais_centimes: 0, total_centimes: 1000 * stations.length, tva_centimes: 3, taux_tva_pourcent: 2.6,
    origine: "http://localhost", lignes: stations.map(ligne),
  }])).rows[0].id;
}
const tickets = (stations: string[]) => JSON.stringify(stations.map((s) => ({ station: s, contenu: [{ t: "texte", texte: s }] })));

describe("commande_postes", () => {
  it("une ligne par poste concerné aux premiers tickets, a_faire_le fixé une seule fois", async () => {
    const id = await commande(["pizza", "cuisine", "pizza"]);
    expect(await postes(id)).toEqual([]);
    await f("premiers_tickets($1, $2::jsonb)", [id, tickets(["pizza", "cuisine"])]);
    const avant = await postes(id);
    expect(avant.map((p) => p.station)).toEqual(["pizza", "cuisine"]);
    const tl = await f<string>("(select tickets_le::text from commandes where id = $1)", [id]);
    expect(avant.every((p) => p.a_faire_le === tl && p.pret_le === null)).toBe(true);
    // Réimpression : a_faire_le ne bouge pas.
    await f("creer_taches_impression($1, $2::jsonb, true)", [id, tickets(["pizza"])]);
    await f("premiers_tickets($1, $2::jsonb)", [id, tickets(["pizza"])]);
    expect((await postes(id)).map((p) => p.a_faire_le)).toEqual(avant.map((p) => p.a_faire_le));
  });

  it("gestes du poste, puis la commande prête ferme les postes restés ouverts", async () => {
    const id = await commande(["pizza", "cuisine"]);
    await f("premiers_tickets($1, $2::jsonb)", [id, tickets(["pizza", "cuisine"])]);
    expect(await f("marquer_poste($1, 'cuisine', 'lancer', $2)", [id, equipe])).toMatchObject({ station: "cuisine", pret_le: null });
    expect(await f("marquer_poste($1, 'cuisine', 'pret', $2)", [id, equipe])).toMatchObject({ pret_par: expect.stringMatching(/^tablette:/) });
    // Erreur de doigt : rouvert, puis de nouveau prêt.
    expect(await f("marquer_poste($1, 'cuisine', 'rouvrir', $2)", [id, equipe])).toMatchObject({ pret_le: null, pret_par: null });
    await f("marquer_poste($1, 'cuisine', 'pret', $2)", [id, equipe]);
    await db.query("update commandes set statut = 'prete' where id = $1", [id]);
    // Ordre du type station : pizza, puis cuisine.
    const [pizza, cuisine] = await postes(id);
    expect(cuisine.pret_par).toMatch(/^tablette:/);
    expect(cuisine.lance_le).not.toBeNull();
    expect(pizza.pret_par).toBe("statut");
    expect(pizza.pret_le).not.toBeNull();
    // Commande sortie de cuisine : plus de geste.
    expect(await f("marquer_poste($1, 'pizza', 'rouvrir', $2)", [id, equipe])).toBeNull();
    const actifs = await f<{ commande_id: string; pret_par: string }[]>("postes_actifs()");
    expect(actifs.filter((p) => p.commande_id === id).map((p) => p.pret_par).sort()).toEqual(["poste", "statut"]);
  });

  it("refusée : pret_le reste vide ; un poste absent ou un livreur sont refusés", async () => {
    const id = await commande(["pizza"]);
    await f("premiers_tickets($1, $2::jsonb)", [id, tickets(["pizza"])]);
    expect(await f("marquer_poste($1, 'cuisine', 'pret', $2)", [id, equipe])).toBeNull();
    await expect(f("marquer_poste($1, 'pizza', 'pret', $2)", [id, livreur])).rejects.toThrow(/équipe du restaurant/);
    await expect(f("marquer_poste($1, 'pizza', 'tout', $2)", [id, equipe])).rejects.toThrow(/Geste inconnu/);
    await db.query("update commandes set statut = 'refusee' where id = $1", [id]);
    expect((await postes(id))[0].pret_le).toBeNull();
    expect((await f<{ commande_id: string }[]>("postes_actifs()")).some((p) => p.commande_id === id)).toBe(false);
  });

  it("aucun droit pour anon ni authenticated", async () => {
    const droits = (await db.query<{ r: boolean }>("select has_table_privilege('anon', 'commande_postes', 'select') or has_table_privilege('authenticated', 'commande_postes', 'select') as r")).rows[0].r;
    expect(droits).toBe(false);
  });
});
