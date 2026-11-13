import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { champsPrixEnLot } from "@/lib/gestion-lot";

// Prix en lot et duplication (supabase/migrations/20261210110000_prix_en_lot.sql). Les prix attendus se
// calculent à partir de ceux de la base : aucun prix de la carte n'est écrit ici.

let db: PGlite;
let gerant: string;
let service: string;

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
async function prix(categorie: string): Promise<Record<string, { prix: number; a_valider: boolean }>> {
  const r = await db.query<{ slug: string; prix_centimes: number; prix_a_valider: boolean }>(
    "select p.slug, p.prix_centimes, p.prix_a_valider from plats p join categories c on c.id = p.categorie_id where c.slug = $1 and p.archive_le is null and p.origine <> 'jour'", [categorie]);
  return Object.fromEntries(r.rows.map((x) => [x.slug, { prix: x.prix_centimes, a_valider: x.prix_a_valider }]));
}
const arrondir = (c: number, a: number) => Math.round(c / a) * a;

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("prix en lot", () => {
  it("aperçu sans écriture, puis application d'une hausse en pour cent sur une catégorie, arrondie", async () => {
    const avant = await prix("pizzas");
    const lot = { categorie: "pizzas", regle: "pourcentage", valeur: 500, arrondi: 50, prix_valide: true };
    const apercu = await f<{ slug: string; avant: number; apres: number }[]>("prix_en_lot($1, false, $2)", [lot, gerant]);
    expect(apercu.length).toBe(Object.keys(avant).length);
    for (const l of apercu) {
      expect(l.avant).toBe(avant[l.slug].prix);
      expect(l.apres).toBe(arrondir((avant[l.slug].prix * 105) / 100, 50));
    }
    expect(await prix("pizzas")).toEqual(avant);
    expect(await f<number>("(select count(*)::int from journal_gestion)")).toBe(0);

    await f("prix_en_lot($1, true, $2)", [lot, gerant]);
    const apres = await prix("pizzas");
    for (const l of apercu) expect(apres[l.slug]).toEqual({ prix: l.apres, a_valider: false });
    // Un journal « plat » par plat changé : chacun s'annule seul.
    const changes = apercu.filter((l) => l.apres !== l.avant).length;
    expect(await f<number>("(select count(*)::int from journal_gestion where objet = 'plat')")).toBe(changes);
    const un = (await db.query<{ id: number; cle: string }>("select id, cle from journal_gestion where objet = 'plat' order by id limit 1")).rows[0];
    await f("annuler_journal($1, $2)", [un.id, gerant]);
    expect((await prix("pizzas"))[un.cle].prix).toBe(avant[un.cle].prix);
  });

  it("un plat du back-office en vente exige « Prix validé », dès l'aperçu", async () => {
    const p = { slug: "risotto-essai", categorie: "pates", nom: "Risotto d'essai", description: "", prix_centimes: 100, prix_valide: true, station: "cuisine", provenance: "", provenances_a_fournir: [], allergenes: "lait", retraits: [], groupes: [], commandable: true };
    await f("ajouter_plat($1, $2)", [p, gerant]);
    const lot = { categorie: "pates", regle: "montant", valeur: 100 };
    expect(await erreur("prix_en_lot($1, false, $2)", [lot, gerant])).toContain("plat_incomplet");
    expect((await f<unknown[]>("prix_en_lot($1, true, $2)", [{ ...lot, prix_valide: true }, gerant])).length).toBeGreaterThan(0);
  });

  it("sans « Prix validé », les prix changés repartent à valider", async () => {
    const [s] = Object.keys(await prix("desserts"));
    await f("prix_en_lot($1, true, $2)", [{ slugs: [s], regle: "montant", valeur: 100, arrondi: 10 }, gerant]);
    expect((await prix("desserts"))[s].a_valider).toBe(true);
  });

  it("prix fixes plat par plat ; tout ou rien si un prix sort des bornes", async () => {
    const avant = await prix("desserts");
    const [a, b] = Object.keys(avant);
    const nouveaux = { [a]: avant[a].prix + 10, [b]: avant[b].prix + 20 };
    await f("prix_en_lot($1, true, $2)", [{ regle: "fixe", prix: nouveaux, prix_valide: true }, gerant]);
    const apres = await prix("desserts");
    expect(apres[a].prix).toBe(nouveaux[a]);
    expect(apres[b].prix).toBe(nouveaux[b]);
    expect(await erreur("prix_en_lot($1, true, $2)", [{ regle: "fixe", prix: { [a]: 1, [b]: -5 } }, gerant])).toContain("prix_hors_bornes");
    expect((await prix("desserts"))[a].prix).toBe(nouveaux[a]);
  });

  it("refuse une règle, un arrondi, une valeur ou une sélection illisible, et un membre du service", async () => {
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "pizzas", regle: "magie", valeur: 1 }, gerant])).toContain("regle_invalide");
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "pizzas", regle: "montant", valeur: 100, arrondi: 3 }, gerant])).toContain("arrondi_invalide");
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "pizzas", regle: "pourcentage", valeur: 0 }, gerant])).toContain("valeur_invalide");
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "pizzas", regle: "pourcentage", valeur: 9000 }, gerant])).toContain("valeur_invalide");
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "inconnue", regle: "montant", valeur: 100 }, gerant])).toContain("selection_vide");
    expect(await erreur("prix_en_lot($1, false, $2)", [{ categorie: "pizzas", regle: "montant", valeur: 100 }, service])).toContain("Réservé au gérant");
    // Une baisse sous zéro est refusée, sans rien écrire.
    expect(await erreur("prix_en_lot($1, true, $2)", [{ categorie: "pizzas", regle: "montant", valeur: -10000 }, gerant])).toContain("prix_hors_bornes");
  });
});

describe("dupliquer un plat", () => {
  it("copie hors de la vente, avec groupes et retraits, sans la photo envoyée", async () => {
    await db.query("update plats set photo = '11111111-1111-1111-1111-111111111111.jpg' where slug = 'pizza-tonno'");
    const r = await f<{ slug: string; commandable: boolean }>("dupliquer_plat('pizza-tonno', 'pizza-tonno-grande', 'Pizza Tonno grande', $1)", [gerant]);
    expect(r).toMatchObject({ slug: "pizza-tonno-grande", commandable: false });
    const [src, copie] = (await db.query<Record<string, unknown>>("select * from plats where slug in ('pizza-tonno', 'pizza-tonno-grande') order by slug")).rows;
    expect(copie).toMatchObject({ nom: "Pizza Tonno grande", origine: "gestion", commandable: false, photo: null, prix_centimes: src.prix_centimes, station: src.station, categorie_id: src.categorie_id });
    const groupes = async (s: string) => (await db.query("select groupe_id from plat_groupes pg join plats p on p.id = pg.plat_id where p.slug = $1 order by groupe_id", [s])).rows;
    expect(await groupes("pizza-tonno-grande")).toEqual(await groupes("pizza-tonno"));
    const retraits = async (s: string) => (await db.query("select r.nom from plat_retraits r join plats p on p.id = r.plat_id where p.slug = $1 order by r.nom", [s])).rows;
    expect(await retraits("pizza-tonno-grande")).toEqual(await retraits("pizza-tonno"));
    expect((await db.query<{ objet: string; apres: { copie_de: string } }>("select objet, apres from journal_gestion order by id desc limit 1")).rows[0]).toMatchObject({ objet: "plat_ajoute", apres: { copie_de: "pizza-tonno" } });
    // La copie se range juste après son modèle.
    expect(copie.ordre).toBe((src.ordre as number) + 1);
    // Un second « grande » reçoit un suffixe.
    expect((await f<{ slug: string }>("dupliquer_plat('pizza-tonno', 'pizza-tonno-grande', 'Pizza Tonno grande bis', $1)", [gerant])).slug).toBe("pizza-tonno-grande-2");
  });

  it("garde une photo du shooting ; refuse un plat inconnu, un nom vide, un membre du service", async () => {
    const photo = (await db.query<{ photo: string }>("select photo from plats where slug = 'pizza-margherita'")).rows[0].photo;
    await f("dupliquer_plat('pizza-margherita', 'margherita-copie', 'Margherita copie', $1)", [gerant]);
    expect((await db.query<{ photo: string }>("select photo from plats where slug = 'margherita-copie'")).rows[0].photo).toBe(photo);
    expect(await f("dupliquer_plat('inconnu', 'x', 'X', $1)", [gerant])).toBeNull();
    expect(await erreur("dupliquer_plat('pizza-tonno', 'x', '  ', $1)", [gerant])).toContain("nom_invalide");
    expect(await erreur("dupliquer_plat('pizza-tonno', 'x', 'X', $1)", [service])).toContain("Réservé au gérant");
  });

  it("un visiteur n'appelle aucune des deux fonctions", async () => {
    expect(await f("has_function_privilege('anon', 'prix_en_lot(jsonb, boolean, uuid)', 'execute')")).toBe(false);
    expect(await f("has_function_privilege('anon', 'dupliquer_plat(text, text, text, uuid)', 'execute')")).toBe(false);
  });
});

describe("saisie du prix en lot", () => {
  it("valide la règle, la sélection et les bornes", () => {
    expect(champsPrixEnLot({ categorie: "pizzas", regle: "pourcentage", valeur: 500 })).toMatchObject({ ok: true, valeur: { arrondi: 10, prix_valide: false } });
    expect(champsPrixEnLot({ regle: "fixe", prix: { "pizza-tonno": 10 } })).toMatchObject({ ok: true });
    expect(champsPrixEnLot({ regle: "pourcentage", valeur: 500 })).toMatchObject({ ok: false });
    expect(champsPrixEnLot({ categorie: "pizzas", regle: "pourcentage", valeur: 5001 })).toMatchObject({ ok: false });
    expect(champsPrixEnLot({ categorie: "pizzas", regle: "montant", valeur: 1.5 })).toMatchObject({ ok: false });
    expect(champsPrixEnLot({ slugs: [], regle: "montant", valeur: 100 })).toMatchObject({ ok: false });
    expect(champsPrixEnLot({ categorie: "pizzas", regle: "montant", valeur: 100, arrondi: 3 })).toMatchObject({ ok: false });
    expect(champsPrixEnLot({ regle: "fixe", prix: { "pizza-tonno": -1 } })).toMatchObject({ ok: false });
  });
});
