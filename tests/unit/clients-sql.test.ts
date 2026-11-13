import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes : clients du back-office. Un client = un e-mail, avec ou sans compte. Montants tirés
// des commandes créées ici, jamais du seed.

let db: PGlite;
let gerant: string;
let service: string;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function erreur(sql: string, v: unknown[] = []): Promise<string> {
  try {
    await f(sql, v);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "aucune erreur";
}
type O = { email: string; total: number; prenom?: string; nom?: string; tel?: string; refusee?: boolean; livraison?: { rue: string; numero: string }; plat?: string; qte?: number };
async function commande(o: O): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-cli-${n}`, cle_idempotence: `cli-${n}`, mode: o.livraison ? "livraison" : "retrait", statut: "paiement_en_attente",
    statut_paiement: "en_attente", moyen_paiement: "en_ligne", client_prenom: o.prenom ?? "Giulia", client_nom: o.nom ?? "Rossi",
    client_telephone: o.tel ?? "079 555 12 34", client_email: o.email, quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: o.total, frais_centimes: 0, total_centimes: o.total, tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    ...(o.livraison ? { adresse: { ...o.livraison, npa: "1213", localite: "Onex", featureId: `f${n}` }, details_livraison: { sonnette: "R", etage: "", code: "", instructions: "" }, zone_numero: 1 } : {}),
    lignes: [{ slug: "x", nom: o.plat ?? "Lasagne de bœuf", station: "cuisine", qte: o.qte ?? 1, unitaire_centimes: o.total, total_centimes: o.total, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await f("appliquer_paiement($1, $2, 'paye', 'pi_cli', $3)", [`evt-${id}`, id, o.total]);
  if (o.refusee) await f("changer_statut($1, 'refusee', 'tablette:Test', null, 'Complet.')", [id]);
  return id;
}
type Page = { total: number; lignes: Record<string, unknown>[] };
const liste = (p: Record<string, unknown> = {}) => f<Page>("clients_gestion($1)", [p]);

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'gerant-bureau@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("liste des clients", () => {
  it("une ligne par e-mail (majuscules confondues), invités compris, chiffres tirés des commandes", async () => {
    await commande({ email: "giulia@exemple.ch", total: 3000 });
    await commande({ email: "Giulia@Exemple.ch", total: 5000, nom: "Bianchi" });
    await commande({ email: "giulia@exemple.ch", total: 9900, refusee: true });
    await commande({ email: "marco@exemple.ch", total: 2000, prenom: "Marco", nom: "Verdi", tel: "078 111 22 33" });
    const p = await liste();
    expect(p.total).toBe(2);
    const g = p.lignes.find((l) => l.email === "giulia@exemple.ch")!;
    // Le nom est celui de la dernière commande, la refusée ne compte ni dans les commandes ni dans le dépensé.
    expect(g).toMatchObject({ commandes: 2, refusees: 1, depense_centimes: 8000, panier_moyen_centimes: 4000, compte: false, marque: null });
    expect(["Rossi", "Bianchi"]).toContain(g.nom);
  });

  it("retrouve un invité par téléphone, e-mail ou nom ; trie par dépensé", async () => {
    await commande({ email: "a@exemple.ch", total: 1000, prenom: "Anna", nom: "Keller", tel: "+41 79 111 11 11" });
    await commande({ email: "b@exemple.ch", total: 7000, prenom: "Bruno", nom: "Meier", tel: "079 222 22 22" });
    expect((await liste({ recherche: "079 111 11 11" })).lignes.map((l) => l.email)).toEqual(["a@exemple.ch"]);
    expect((await liste({ recherche: "b@exemple" })).lignes.map((l) => l.email)).toEqual(["b@exemple.ch"]);
    expect((await liste({ recherche: "keller" })).lignes.map((l) => l.email)).toEqual(["a@exemple.ch"]);
    expect((await liste({ tri: "depense" })).lignes.map((l) => l.email)).toEqual(["b@exemple.ch", "a@exemple.ch"]);
  });

  it("déduit les remboursements du dépensé et filtre les clients avec compte", async () => {
    const c = await commande({ email: "c@exemple.ch", total: 4000 });
    await commande({ email: "d@exemple.ch", total: 4000 });
    await db.query(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, 'cle-cli-0001', 1500, 'Froid.', 'stripe', 'fait', 'Gérant', now())",
      [c],
    );
    await db.query("insert into comptes (email) values ('d@exemple.ch')");
    expect((await liste()).lignes.find((l) => l.email === "c@exemple.ch")?.depense_centimes).toBe(2500);
    expect((await liste({ avec_compte: true })).lignes.map((l) => l.email)).toEqual(["d@exemple.ch"]);
  });
});

describe("fiche client", () => {
  it("chiffres, adresses, téléphones, plats préférés, commandes, remboursements et compte", async () => {
    await commande({ email: "e@exemple.ch", total: 3000, livraison: { rue: "Route de Chancy", numero: "1" }, plat: "Pizza Margherita", qte: 2 });
    await commande({ email: "e@exemple.ch", total: 5000, livraison: { rue: "Route de Chancy", numero: "1" }, plat: "Pizza Margherita", tel: "078 000 00 01" });
    await commande({ email: "e@exemple.ch", total: 1000, plat: "Tiramisu" });
    const fiche = await f<Record<string, unknown>>("fiche_client_gestion($1)", ["E@exemple.ch "]);
    expect(fiche).toMatchObject({ email: "e@exemple.ch", commandes: 3, servi_centimes: 9000, panier_moyen_centimes: 3000, livraisons: 2, retraits: 1, compte: null, marque: null, marque_active: false });
    // Même adresse (identifiant du registre différent) comptée une fois, deux fois utilisée.
    expect(fiche.adresses).toEqual([expect.objectContaining({ fois: 2, adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" } })]);
    expect(fiche.telephones).toHaveLength(2);
    expect((fiche.plats as { nom: string; qte: number }[])[0]).toEqual({ nom: "Pizza Margherita", qte: 3 });
    expect(fiche.commandes_liste).toHaveLength(3);
    expect(await f("fiche_client_gestion($1)", ["inconnu@exemple.ch"])).toBeNull();
  });
});

describe("notes et marque", () => {
  it("note : gérant seulement, journalisée, visible dans la liste et la fiche", async () => {
    await commande({ email: "f@exemple.ch", total: 2000 });
    expect(await erreur("ajouter_note_client('f@exemple.ch', 'Allergique aux noix', $1)", [service])).toContain("Réservé au gérant");
    expect(await erreur("ajouter_note_client('personne@exemple.ch', 'Note', $1)", [gerant])).toContain("client_inconnu");
    await f("ajouter_note_client('F@exemple.ch', 'Allergique aux noix, le dit à chaque appel', $1)", [gerant]);
    expect((await liste()).lignes[0].notes).toBe(1);
    const j = (await db.query<{ objet: string; cle: string }>("select objet, cle from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toEqual({ objet: "note_client", cle: "f@exemple.ch" });
  });

  it("marque désactivée par défaut ; activée : posée, retirée, journalisée, retrouvée par téléphone", async () => {
    await commande({ email: "g@exemple.ch", total: 2000, tel: "079 333 33 33" });
    expect(await erreur("marquer_client('g@exemple.ch', 'bloque', 'Trois commandes au comptoir jamais retirées', $1)", [gerant])).toContain("marque_desactivee");
    await db.query("update reglages set valeur = 'true' where cle = 'marque_client_active'");
    expect(await erreur("marquer_client('g@exemple.ch', 'bloque', 'Trois commandes au comptoir jamais retirées', $1)", [service])).toContain("Réservé au gérant");
    expect(await erreur("marquer_client('g@exemple.ch', 'banni', 'Motif', $1)", [gerant])).toContain("marque_invalide");
    expect(await erreur("marquer_client('g@exemple.ch', 'bloque', '', $1)", [gerant])).toContain("motif_invalide");
    await f("marquer_client('g@exemple.ch', 'bloque', 'Trois commandes au comptoir jamais retirées', $1)", [gerant]);
    expect((await liste({ marque: "bloque" })).lignes.map((l) => l.email)).toEqual(["g@exemple.ch"]);
    // Autre adresse, même téléphone : la marque suit.
    expect(await f("client_marque('autre@exemple.ch', '+41 79 333 33 33')")).toBe("bloque");
    await f("marquer_client('g@exemple.ch', null, null, $1)", [gerant]);
    expect(await f("client_marque('g@exemple.ch', null)")).toBeNull();
    const j = (await db.query<{ avant: unknown; apres: unknown }>("select avant, apres from journal_gestion where objet = 'client' order by id")).rows;
    expect(j).toEqual([
      { avant: null, apres: { marque: "bloque", motif: "Trois commandes au comptoir jamais retirées" } },
      { avant: { marque: "bloque", motif: "Trois commandes au comptoir jamais retirées" }, apres: null },
    ]);
    // Réglage éteint : la marque posée reste en base mais n'a plus d'effet.
    await f("marquer_client('g@exemple.ch', 'surveiller', 'Réclame souvent', $1)", [gerant]);
    await db.query("update reglages set valeur = 'false' where cle = 'marque_client_active'");
    expect(await f("client_marque('g@exemple.ch', null)")).toBeNull();
  });

  it("nLPD : notes et marque dans l'export, notes effacées avec le compte, marque gardée", async () => {
    await commande({ email: "h@exemple.ch", total: 2000 });
    await f("ajouter_note_client('h@exemple.ch', 'Livrer par la porte arrière', $1)", [gerant]);
    expect(await f("donnees_gestion_client('H@exemple.ch')")).toMatchObject({ notes: [{ texte: "Livrer par la porte arrière" }], marque: null });
    expect(await f("effacer_notes_client('h@exemple.ch')")).toBe(1);
    expect(await f("donnees_gestion_client('h@exemple.ch')")).toMatchObject({ notes: [] });
  });

  it("aucun droit direct pour un visiteur", async () => {
    expect(await f("has_table_privilege('anon', 'notes_client', 'select') or has_table_privilege('anon', 'marques_client', 'select') or has_function_privilege('anon', 'clients_gestion(jsonb)', 'execute')")).toBe(false);
  });
});
