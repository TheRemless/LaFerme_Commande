import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Livreurs côté base (migration 20261117090000_livreurs.sql) : attribution, réattribution, deux livreurs,
// gestes sans doublon, annulation pendant la tournée, client absent, journal.

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

type Liste = {
  livraisons: { commande_id: string; numero: number; statut: string; prenom: string; details: { code: string }; articles: number; pizzas: number; paye: boolean; probleme: string | null }[];
  retirees: { commande_id: string; raison: string; partie: boolean }[];
};
const liste = (livreur: string) => f<Liste>("livraisons_livreur($1)", [livreur]);
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

describe("rôle livreur", () => {
  it("le gérant ajoute un livreur, un rôle inconnu reste refusé", async () => {
    const g = await id("equipe@laferme.test");
    await f("ajouter_personnel('nouveau@laferme.test', 'Nouveau', 'livreur', $1)", [g]);
    expect(await f<string>("(select role from personnel where email = 'nouveau@laferme.test')")).toBe("livreur");
    await expect(f("ajouter_personnel('autre@laferme.test', 'Autre', 'chef', $1)", [g])).rejects.toThrow(/role_invalide/);
    expect(await f<boolean>("modifier_personnel($1, '{\"role\": \"service\"}', $2)", [marco, g])).toBe(true);
    expect(await f<string>("(select role from personnel where id = $1)", [marco])).toBe("service");
  });
});

describe("attribution", () => {
  it("seule une commande en livraison acceptée, à un livreur actif", async () => {
    const c = await livraison("nouvelle");
    expect(await attribuer(c, marco)).toBe("commande");
    await db.query("update commandes set statut = 'acceptee' where id = $1", [c]);
    expect(await attribuer(c, await id("equipe@laferme.test"))).toBe("livreur");
    expect(await attribuer(c, marco)).toBe("ok");
    expect(await attribuer(c, marco)).toBe("deja");
  });

  it("deux livreurs : chacun ne voit que ses livraisons, avec ce qu'il faut pour livrer", async () => {
    const a = await livraison();
    const b = await livraison();
    await attribuer(a, marco);
    await attribuer(b, ines);
    const m = await liste(marco);
    expect(m.livraisons.map((x) => x.commande_id)).toEqual([a]);
    expect(m.livraisons[0]).toMatchObject({ details: { code: "4512" }, articles: 3, pizzas: 2, paye: true });
    // Pas de nom de famille ni d'e-mail du client sur le téléphone.
    expect(JSON.stringify(m)).not.toContain("Secret");
    expect(JSON.stringify(m)).not.toContain("liv@laferme.test");
    expect((await liste(ines)).livraisons.map((x) => x.commande_id)).toEqual([b]);
    // Ines ne peut pas agir sur la livraison de Marco.
    expect(await geste("cle-ines-0000000001", ines, a, "partie")).toMatchObject({ ok: false, raison: "pas_a_vous" });
    expect(await statut(a)).toBe("acceptee");
  });

  it("réattribuée : l'ancien livreur ne voit plus l'adresse, seulement le numéro à lire", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await liste(marco);
    await liste(marco);
    await geste("cle-marco-000000001", marco, c, "partie");
    expect(await attribuer(c, ines)).toBe("ok");
    const m = await liste(marco);
    expect(m.livraisons).toEqual([]);
    expect(m.retirees).toEqual([{ commande_id: c, numero: expect.any(Number), raison: "reattribuee", partie: true }]);
    expect(JSON.stringify(m.retirees)).not.toContain("Gros-Chêne");
    expect((await liste(ines)).livraisons.map((x) => x.commande_id)).toEqual([c]);
    expect(await geste("cle-marco-000000002", marco, c, "livree")).toMatchObject({ ok: false, raison: "pas_a_vous" });
    expect((await geste("cle-marco-000000003", marco, c, "compris")).ok).toBe(true);
    expect((await liste(marco)).retirees).toEqual([]);
    const journal = await f<{ evenement: string; par: string; detail: string | null }[]>("journal_livraison($1)", [c]);
    // La première lecture de l'adresse par chaque livreur (« vue ») est journalisée, une seule fois.
    expect(journal.map((j) => `${j.evenement} ${j.par}`)).toEqual([
      "attribuee tablette:Test",
      "vue livreur:Marco",
      "partie livreur:Marco",
      "reattribuee tablette:Test",
      "vue livreur:Inès",
      "compris livreur:Marco",
    ]);
    expect(journal.find((j) => j.evenement === "reattribuee")?.detail).toBe("Marco → Inès");
  });
});

describe("rendue au même livreur", () => {
  it("Marco → Inès → Marco : la livraison est dans sa liste, sans alerte « n'est plus à vous »", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await attribuer(c, ines);
    await attribuer(c, marco);
    const m = await liste(marco);
    expect(m.livraisons.map((x) => x.commande_id)).toEqual([c]);
    expect(m.retirees).toEqual([]);
    expect((await liste(ines)).retirees.map((x) => x.raison)).toEqual(["reattribuee"]);
  });
});

describe("gestes", () => {
  it("« Je pars » renvoyé après une coupure : une seule fois partie, un seul e-mail", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    expect(await geste("cle-reseau-00000001", marco, c, "partie")).toEqual({ ok: true, prevenir: true });
    expect(await geste("cle-reseau-00000001", marco, c, "partie")).toEqual({ ok: true, prevenir: false, deja: true });
    // Nouvel appui (autre clé) : déjà partie, rien à prévenir.
    expect(await geste("cle-reseau-00000002", marco, c, "partie")).toEqual({ ok: true, prevenir: false });
    expect(await statut(c)).toBe("partie");
    expect(await f<number>("(select count(*)::int from evenements_commande where commande_id = $1 and vers = 'partie')", [c])).toBe(1);
    expect(await f<string>("(select par from evenements_commande where commande_id = $1 and vers = 'partie')", [c])).toBe("livreur:Marco");
    // Même clé pour un autre geste : refusée.
    expect(await geste("cle-reseau-00000001", marco, c, "livree")).toMatchObject({ ok: false, raison: "cle" });
  });

  it("« Livrée » : la livraison disparaît du téléphone", async () => {
    const c = await livraison("en_preparation");
    await attribuer(c, marco);
    // Livrée sans « Je pars » : passe par partie, sans e-mail.
    expect(await geste("cle-livree-00000001", marco, c, "livree")).toEqual({ ok: true, prevenir: false });
    expect(await statut(c)).toBe("terminee");
    expect(await liste(marco)).toEqual({ livraisons: [], retirees: [] });
  });

  it("client absent : signalé avec un mot, visible sur la tablette, puis livrée au second passage", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await geste("cle-absent-00000001", marco, c, "partie");
    expect(await geste("cle-absent-00000002", marco, c, "probleme", "autre", null)).toMatchObject({ ok: false, raison: "detail" });
    expect((await geste("cle-absent-00000003", marco, c, "probleme", "client_absent", "  Sonné deux fois  ")).ok).toBe(true);
    const t = await f<{ livraisons: { commande_id: string; probleme: string; probleme_detail: string }[] }>("livreurs_tablette()");
    expect(t.livraisons.find((x) => x.commande_id === c)).toMatchObject({ probleme: "client_absent", probleme_detail: "Sonné deux fois" });
    expect((await liste(marco)).livraisons[0].probleme).toBe("client_absent");
    expect((await geste("cle-absent-00000004", marco, c, "livree")).ok).toBe(true);
    expect(await statut(c)).toBe("terminee");
  });

  it("commande annulée pendant la tournée : le livreur lit « annulée » sans l'adresse, puis plus rien", async () => {
    const c = await livraison();
    const autre = await livraison();
    await attribuer(c, marco);
    await attribuer(autre, marco);
    await geste("cle-annul-000000001", marco, c, "partie");
    // La tablette annule une commande partie (client absent, remboursement) : permis désormais.
    // changer_statut (partagée) ne le permet toujours pas : fonction à part.
    expect(await f<boolean>("changer_statut($1, 'refusee', 'tablette:Test', null, 'Client absent.', 'partie')", [c])).toBe(false);
    expect(await f<boolean>("annuler_commande_partie($1, 'tablette:Test', '  ')", [c])).toBe(false);
    expect(await f<boolean>("annuler_commande_partie($1, 'tablette:Test', 'Client absent.')", [c])).toBe(true);
    expect(await f<boolean>("annuler_commande_partie($1, 'tablette:Test', 'Client absent.')", [c])).toBe(false);
    const m = await liste(marco);
    expect(m.livraisons.map((x) => x.commande_id)).toEqual([autre]);
    expect(m.retirees).toEqual([{ commande_id: c, numero: expect.any(Number), raison: "annulee", partie: true }]);
    expect(await geste("cle-annul-000000002", marco, c, "livree")).toMatchObject({ ok: false, raison: "annulee" });
    const t = await f<{ livraisons: { commande_id: string; commande_statut: string }[] }>("livreurs_tablette()");
    expect(t.livraisons.find((x) => x.commande_id === c)?.commande_statut).toBe("refusee");
    expect((await geste("cle-annul-000000003", marco, c, "compris")).ok).toBe(true);
    expect((await liste(marco)).retirees).toEqual([]);
    expect((await f<{ livraisons: { commande_id: string }[] }>("livreurs_tablette()")).livraisons.map((x) => x.commande_id)).toEqual([autre]);
  });

  it("client absent clos par la tablette : terminée sans remboursement, motif fixe, le livreur lit « close »", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    // Pas encore partie : rien à clore.
    expect(await f<string | null>("clore_client_absent($1, 'tablette:Test')", [c])).toBeNull();
    await geste("cle-clos-0000000001", marco, c, "partie");
    await geste("cle-clos-0000000002", marco, c, "probleme", "client_absent", null);
    const passage = await f<string | null>("clore_client_absent($1, 'tablette:Test')", [c]);
    expect(passage).toBeTruthy();
    const o = (await db.query<{ statut: string; statut_paiement: string; motif: string }>("select statut, statut_paiement, motif from commandes where id = $1", [c])).rows[0];
    expect(o).toEqual({ statut: "terminee", statut_paiement: "paye", motif: "Client absent à la livraison." });
    expect(await f<string | null>("clore_client_absent($1, 'tablette:Test')", [c])).toBeNull();
    const m = await liste(marco);
    expect(m.livraisons).toEqual([]);
    expect(m.retirees).toEqual([{ commande_id: c, numero: expect.any(Number), raison: "client_absent", partie: true }]);
    expect((await geste("cle-clos-0000000003", marco, c, "compris")).ok).toBe(true);
    expect((await liste(marco)).retirees).toEqual([]);
    // Le gérant peut ensuite rembourser après coup (commande terminée).
    const g = await id("equipe@laferme.test");
    const r = await f<{ statut?: string; erreur?: string }>("demander_remboursement($1, 1000, 'Geste client absent', 'cle-remb-absent', $2)", [c, g]);
    expect(r.statut).toBe("en_cours");
    const journal = await f<{ evenement: string }[]>("journal_livraison($1)", [c]);
    expect(journal.map((j) => j.evenement)).toContain("client_absent");
  });

  it("livreur déconnecté en tournée : ses livraisons l'attendent à sa reconnexion", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await geste("cle-deco-0000000001", marco, c, "partie");
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1, 'h-deco', now() + interval '1 day')", [marco]);
    await f("deconnecter_personnel('h-deco', null)");
    expect((await liste(marco)).livraisons.map((x) => x.commande_id)).toEqual([c]);
    const t = await f<{ livreurs: { id: string; vu_le: string | null }[] }>("livreurs_tablette()");
    expect(t.livreurs.find((x) => x.id === marco)?.vu_le).toBeTruthy();
  });

  it("livreur retiré de l'équipe en tournée : la tablette le montre encore pour réattribuer", async () => {
    const c = await livraison();
    await attribuer(c, marco);
    await db.query("update personnel set actif = false where id = $1", [marco]);
    const t = await f<{ livreurs: { id: string; actif: boolean }[] }>("livreurs_tablette()");
    expect(t.livreurs.find((x) => x.id === marco)).toMatchObject({ actif: false });
    expect(await attribuer(c, ines)).toBe("ok");
  });
});

describe("ordre de passage", () => {
  it("range dans l'ordre donné, ignore les commandes d'un autre livreur", async () => {
    const a = await livraison();
    const b = await livraison();
    const x = await livraison();
    await attribuer(a, marco);
    await attribuer(b, marco);
    await attribuer(x, ines);
    expect(await f<boolean>("ordonner_livraisons($1, $2::uuid[], true, 'tablette:Test')", [marco, [b, x, a]])).toBe(true);
    expect((await liste(marco)).livraisons.map((l) => l.commande_id)).toEqual([b, a]);
    expect((await liste(ines)).livraisons.map((l) => l.commande_id)).toEqual([x]);
    const o = await f<{ commande_id: string; ordre_manuel: boolean }[]>("livraisons_a_ordonner($1)", [marco]);
    expect(o.every((l) => l.ordre_manuel)).toBe(true);
  });
});

describe("droits", () => {
  it("aucune des nouvelles tables ni fonctions n'est ouverte aux visiteurs", async () => {
    for (const t of ["livraisons", "gestes_livreur", "journal_livraisons", "activite_livreurs"]) {
      await expect(db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query(`select * from ${t}`); })).rejects.toThrow(/permission denied/);
    }
    await expect(db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query("select livreurs_tablette()"); })).rejects.toThrow(/permission denied/);
  });
});
