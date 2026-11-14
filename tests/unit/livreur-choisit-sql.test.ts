import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Le livreur choisit ses commandes et son ordre ; le gérant ou le responsable peut livrer (migration
// 20261215090000_livreur_choisit.sql, réponses de Jérémy du 14.11.2026).

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
      jeton_suivi: `jeton-choix-${n}`,
      cle_idempotence: `choix-${n}`,
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

const ticketsSortis = (c: string) => db.query("update commandes set tickets_le = now() where id = $1", [c]);
const prendre = (c: string, l: string) => f<{ ok: boolean; raison?: string; par?: string }>("prendre_livraison($1, $2)", [c, l]);
const aPrendre = () => f<{ commande_id: string; npa: string; rue?: string }[]>("livraisons_a_prendre()");
let cle = 0;
const geste = (l: string, c: string, g: string) => f<{ ok: boolean }>("geste_livreur($1, $2, $3, $4, null, null)", [`cle-choix-${String(++cle).padStart(8, "0")}`, l, c, g]);
const noter = (l: string, lat: number, lon: number) => f<{ statut: string }>("noter_position_livreur($1, $2, $3, 12)", [l, lat, lon]);
const suivi = (c: string) => f<{ lat: number } | null>("position_pour_suivi($1)", [c]);
const roleResponsable = (actif: boolean) => db.query(`update reglages set valeur = '${actif}' where cle = 'role_responsable_actif'`);

let marco: string;
let ines: string;
let gerant: string;
let responsable: string;
let service: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  marco = await id("marco@laferme.test");
  ines = await id("ines@laferme.test");
  gerant = await id("gerant-bureau@laferme.test");
  responsable = await id("responsable-tablette-bureau@laferme.test");
  service = await id("equipe-bureau@laferme.test");
  await roleResponsable(true);
});

describe("le livreur prend ses commandes", () => {
  it("« À prendre » : livraisons acceptées, tickets sortis, sans livreur ; quartier sans adresse complète", async () => {
    const a = await livraison();
    const b = await livraison();
    expect((await aPrendre()).map((x) => x.commande_id)).not.toContain(a);
    await ticketsSortis(a);
    await ticketsSortis(b);
    const liste = await aPrendre();
    expect(liste.map((x) => x.commande_id)).toEqual(expect.arrayContaining([a, b]));
    expect(liste.find((x) => x.commande_id === a)).toMatchObject({ npa: "1213" });
    expect(liste.find((x) => x.commande_id === a)?.rue).toBeUndefined();
    expect(await prendre(a, marco)).toEqual({ ok: true });
    expect((await aPrendre()).map((x) => x.commande_id)).not.toContain(a);
  });

  it("deux livreurs sur la même commande : un seul gagne, l'autre lit qui l'a prise", async () => {
    const a = await livraison();
    await ticketsSortis(a);
    expect(await prendre(a, marco)).toEqual({ ok: true });
    expect(await prendre(a, ines)).toEqual({ ok: false, raison: "prise", par: "Marco" });
    expect((await db.query("select livreur_id from livraisons where commande_id = $1 and retiree_le is null", [a])).rows).toEqual([{ livreur_id: marco }]);
    expect((await db.query<{ evenement: string }>("select evenement from journal_livraisons where commande_id = $1", [a])).rows.map((r) => r.evenement)).toContain("prise");
  });

  it("commande refusée ou retrait : rien à prendre", async () => {
    const a = await livraison();
    await db.query("update commandes set statut = 'refusee' where id = $1", [a]);
    expect(await prendre(a, marco)).toEqual({ ok: false, raison: "commande" });
  });
});

describe("le gérant ou le responsable peut livrer", () => {
  it("gérant toujours, responsable au rôle ouvert, équipe de service jamais", async () => {
    expect(await f<boolean>("peut_livrer($1)", [gerant])).toBe(true);
    expect(await f<boolean>("peut_livrer($1)", [responsable])).toBe(true);
    expect(await f<boolean>("peut_livrer($1)", [service])).toBe(false);
    await roleResponsable(false);
    expect(await f<boolean>("peut_livrer($1)", [responsable])).toBe(false);
    const a = await livraison();
    await ticketsSortis(a);
    expect(await prendre(a, service)).toEqual({ ok: false, raison: "livreur" });
    expect(await prendre(a, responsable)).toEqual({ ok: false, raison: "livreur" });
  });

  it("le gérant prend, part, partage sa position et livre ; il apparaît dans la liste de la tablette", async () => {
    const a = await livraison();
    await ticketsSortis(a);
    expect(await prendre(a, gerant)).toEqual({ ok: true });
    expect(await geste(gerant, a, "partie")).toMatchObject({ ok: true });
    expect(await noter(gerant, 46.19, 6.1)).toMatchObject({ statut: "ok" });
    expect(await suivi(a)).toMatchObject({ lat: 46.19 });
    expect(await geste(gerant, a, "livree")).toMatchObject({ ok: true });
    const tab = await f<{ livreurs: { id: string; role: string; actif: boolean }[] }>("livreurs_tablette()");
    expect(tab.livreurs.find((l) => l.id === gerant)).toMatchObject({ role: "gerant", actif: true });
    expect(tab.livreurs.find((l) => l.id === service)).toBeUndefined();
  });
});

describe("le livreur range sa tournée", () => {
  it("changer l'ordre en route ne montre jamais au client B la porte du client A", async () => {
    const a = await livraison();
    const b = await livraison();
    await f("attribuer_livraison($1, $2, 'tablette:Test')", [a, marco]);
    await f("attribuer_livraison($1, $2, 'tablette:Test')", [b, marco]);
    await geste(marco, a, "partie");
    await geste(marco, b, "partie");
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(a)).toMatchObject({ lat: 46.1843 });
    // Devant la porte de A, le livreur passe B en premier.
    expect(await f<boolean>("ordonner_livraisons($1, $2, true, 'livreur:Marco')", [marco, [b, a]])).toBe(true);
    expect(await suivi(a)).toBeNull();
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(b)).toBeNull();
    // À plus de 400 m de la porte de A : le trajet vers B se voit.
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    await noter(marco, 46.2, 6.12);
    expect(await suivi(b)).toMatchObject({ lat: 46.2 });
    expect(await suivi(a)).toBeNull();
  });

  it("ordre sans changement de l'arrêt en cours : la position reste", async () => {
    const a = await livraison();
    const b = await livraison();
    const c = await livraison();
    for (const x of [a, b, c]) await f("attribuer_livraison($1, $2, 'tablette:Test')", [x, marco]);
    await geste(marco, a, "partie");
    await noter(marco, 46.19, 6.1);
    await f("ordonner_livraisons($1, $2, true, 'livreur:Marco')", [marco, [a, c, b]]);
    expect(await suivi(a)).toMatchObject({ lat: 46.19 });
  });
});
