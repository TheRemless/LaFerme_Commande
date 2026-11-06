import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { recommander } from "@/lib/comptes/recommander";
import type { Catalogue } from "@/lib/panier";

let db: PGlite;
beforeAll(async () => {
  db = await creerBaseLocale();
});

// Empreintes factices : 64 caractères hexadécimaux, comme celles du serveur.
let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");

async function f<T>(sql: string, valeurs: unknown[]): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}

type Cles = { email: string; cleEmail: string; ip: string };
const nouvellesCles = (email: string): Cles => ({ email, cleEmail: h(), ip: h() });
const demander = (c: Cles, code: string) => f<number>("demander_code($1, $2, $3, $4, 'ip')", [c.email, c.cleEmail, c.ip, code]);
const verifier = (c: Cles, code: string, session = h(), jeton: string | null = null, ip = c.ip) =>
  f<{ statut: string; compte_id?: string; attente?: number }>("verifier_code($1, $2, $3, $4, 'ip', $5, null, $6)", [c.email, c.cleEmail, ip, code, session, jeton]);
// Le délai entre deux essais faux est réel : on le vide pour enchaîner les essais du test.
const sansDelai = () => db.query("update codes_connexion set prochain_essai_le = now()");

describe("connexion par code", () => {
  it("compare en temps constant et refuse ce qui n'est pas une empreinte", async () => {
    const a = h();
    expect(await f<boolean>("egal_constant($1, $2)", [a, a])).toBe(true);
    expect(await f<boolean>("egal_constant($1, $2)", [a, h()])).toBe(false);
    expect(await f<boolean>("egal_constant($1, $2)", ["abc", "abc"])).toBe(false);
  });

  it("crée le compte au premier bon code, consomme le code et ouvre une session", async () => {
    const c = nouvellesCles("nouveau@exemple.test");
    const code = h();
    expect(await demander(c, code)).toBe(0);
    const session = h();
    const r = await verifier(c, code, session);
    expect(r.statut).toBe("ok");
    expect(await f<{ email: string }>("compte_de_session($1)", [session])).toMatchObject({ email: "nouveau@exemple.test" });
    // Usage unique : le même code ne marche plus.
    expect((await verifier(c, code)).statut).toBe("invalide");
  });

  it("annule le code après cinq essais faux, avec un délai croissant entre deux essais", async () => {
    const c = nouvellesCles("cinq@exemple.test");
    const bon = h();
    await demander(c, bon);
    expect((await verifier(c, h())).statut).toBe("invalide");
    // Tout de suite après un échec : attendre.
    expect((await verifier(c, bon)).statut).toBe("attente");
    for (let i = 0; i < 4; i++) {
      await sansDelai();
      expect((await verifier(c, h())).statut).toBe("invalide");
    }
    await sansDelai();
    // Même bon, le code est annulé (une autre IP, pour ne pas tomber sur la limite par IP).
    expect((await verifier(c, bon, h(), null, h())).statut).toBe("invalide");
  });

  it("limite l'envoi par e-mail avec un délai croissant", async () => {
    const c = nouvellesCles("envoi@exemple.test");
    expect(await demander(c, h())).toBe(0);
    const attente = await demander({ ...c, ip: h() }, h());
    expect(attente).toBeGreaterThan(0);
    expect(attente).toBeLessThanOrEqual(30);
  });

  it("limite l'envoi par IP, quel que soit l'e-mail", async () => {
    const ip = h();
    for (let i = 0; i < 20; i++) expect(await demander({ email: `ip${i}@exemple.test`, cleEmail: h(), ip }, h())).toBe(0);
    expect(await demander({ email: "ip-de-trop@exemple.test", cleEmail: h(), ip }, h())).toBeGreaterThan(0);
  });

  it("limite les essais faux par IP, sur tous les e-mails", async () => {
    const ip = h();
    for (let i = 0; i < 5; i++) {
      const c = { ...nouvellesCles(`essai${i}@exemple.test`), ip };
      await demander(c, h());
      expect((await verifier(c, h(), h(), null, ip)).statut).toBe("invalide");
    }
    const c = { ...nouvellesCles("bloque@exemple.test"), ip };
    const bon = h();
    await demander(c, bon);
    expect((await verifier(c, bon, h(), null, ip)).statut).toBe("attente");
  });

  it("répond pareil, que le compte existe ou non", async () => {
    const existant = nouvellesCles("existe@exemple.test");
    const code = h();
    await demander(existant, code);
    await verifier(existant, code);
    const inconnu = nouvellesCles("inconnu@exemple.test");
    expect(await demander({ ...existant, cleEmail: h(), ip: h() }, h())).toBe(await demander(inconnu, h()));
    expect(await verifier(nouvellesCles("existe@exemple.test"), h())).toEqual(await verifier(inconnu, h()));
  });

  it("un nouveau code annule le précédent", async () => {
    const c = nouvellesCles("deux@exemple.test");
    const premier = h();
    await demander(c, premier);
    await db.query("update tentatives_connexion set le = now() - interval '2 minutes' where cle = $1", [c.cleEmail]);
    expect(await demander(c, h())).toBe(0);
    expect((await verifier(c, premier)).statut).toBe("invalide");
  });

  it("un code expiré ne marche plus", async () => {
    const c = nouvellesCles("expire@exemple.test");
    const code = h();
    await demander(c, code);
    await db.query("update codes_connexion set expire_le = now() - interval '1 second' where cle_email = $1", [c.cleEmail]);
    expect((await verifier(c, code)).statut).toBe("invalide");
  });
});

describe("sessions", () => {
  async function connecter(email: string) {
    const c = nouvellesCles(email);
    const code = h();
    await demander(c, code);
    const session = h();
    const r = await verifier(c, code, session);
    return { session, compte: r.compte_id!, c };
  }

  it("ferme l'ancienne session du navigateur à la connexion", async () => {
    const a = await connecter("regen@exemple.test");
    const c = nouvellesCles("regen@exemple.test");
    const code = h();
    await demander({ ...c, cleEmail: h() }, code);
    await db.query("update codes_connexion set cle_email = $1 where code_hache = $2", [c.cleEmail, code]);
    const nouvelle = h();
    await f("verifier_code($1, $2, $3, $4, 'ip', $5, $6, null)", [c.email, c.cleEmail, c.ip, code, nouvelle, a.session]);
    expect(await f("compte_de_session($1)", [a.session])).toBeNull();
    expect(await f("compte_de_session($1)", [nouvelle])).not.toBeNull();
  });

  it("déconnecte ce navigateur, ou tous les appareils", async () => {
    const a = await connecter("partout@exemple.test");
    const b = await connecter("partout@exemple.test");
    const c = await connecter("partout@exemple.test");
    await f("deconnecter($1, false, 'ip')", [a.session]);
    expect(await f("compte_de_session($1)", [a.session])).toBeNull();
    expect(await f("compte_de_session($1)", [b.session])).not.toBeNull();
    await f("deconnecter($1, true, 'ip')", [b.session]);
    expect(await f("compte_de_session($1)", [c.session])).toBeNull();
  });

  it("une session expirée ne vaut plus rien", async () => {
    const a = await connecter("vieille@exemple.test");
    await db.query("update sessions_compte set expire_le = now() - interval '1 second' where jeton_hache = $1", [a.session]);
    expect(await f("compte_de_session($1)", [a.session])).toBeNull();
  });
});

const commande = (cle: string, email: string, compte: string | null = null) => ({
  jeton_suivi: `jeton-compte-${cle}`,
  cle_idempotence: `compte-${cle}`,
  mode: "livraison",
  statut: "nouvelle",
  statut_paiement: "paye",
  moyen_paiement: "en_ligne",
  client_prenom: "Léa",
  client_nom: "Test",
  client_telephone: "079 000 00 00",
  client_email: email,
  adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex", featureId: "123_0" },
  details_livraison: { etage: "", sonnette: "Test", code: "", instructions: "" },
  zone_numero: 1,
  quand_type: "asap",
  pizzas_seulement: true,
  sous_total_centimes: 1000,
  frais_centimes: 0,
  total_centimes: 1000,
  tva_centimes: 25,
  taux_tva_pourcent: 2.6,
  origine: "http://localhost:3000",
  compte_id: compte,
  compte_demande: compte === null,
  lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 500, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
});

describe("compte et commandes", () => {
  async function connecter(email: string, jeton: string | null = null) {
    const c = nouvellesCles(email);
    const code = h();
    await demander(c, code);
    const session = h();
    const r = await verifier(c, code, session, jeton);
    return r.compte_id!;
  }

  it("rattache la commande du lien de suivi seulement si l'e-mail est le même", async () => {
    await db.query("select * from creer_commande($1)", [commande("a", "lea@exemple.test")]);
    await db.query("select * from creer_commande($1)", [commande("b", "autre@exemple.test")]);
    const compte = await connecter("lea@exemple.test", "jeton-compte-a");
    await connecter("lea@exemple.test", "jeton-compte-b");
    const proprietaires = (await db.query<{ cle_idempotence: string; compte_id: string | null }>(
      "select cle_idempotence, compte_id from commandes where cle_idempotence in ('compte-a', 'compte-b') order by 1",
    )).rows;
    expect(proprietaires).toEqual([
      { cle_idempotence: "compte-a", compte_id: compte },
      { cle_idempotence: "compte-b", compte_id: null },
    ]);
    // Profil complété et adresse gardée depuis la commande.
    const espace = await f<{ compte: { prenom: string }; adresses: unknown[]; commandes: unknown[] }>("espace_compte($1)", [compte]);
    expect(espace.compte.prenom).toBe("Léa");
    expect(espace.adresses).toHaveLength(1);
    expect(espace.commandes).toHaveLength(1);
  });

  it("une commande passée connecté va dans le compte et garde l'adresse une seule fois", async () => {
    const compte = await connecter("connecte@exemple.test");
    await db.query("select * from creer_commande($1)", [commande("c1", "connecte@exemple.test", compte)]);
    await db.query("select * from creer_commande($1)", [commande("c2", "connecte@exemple.test", compte)]);
    const espace = await f<{ adresses: unknown[]; commandes: unknown[] }>("espace_compte($1)", [compte]);
    expect(espace.commandes).toHaveLength(2);
    expect(espace.adresses).toHaveLength(1);
    const demande = (await db.query<{ compte_demande: boolean }>("select compte_demande from commandes where cle_idempotence = 'compte-c1'")).rows[0];
    expect(demande.compte_demande).toBe(false);
  });

  it("ne donne jamais les données d'un autre compte", async () => {
    const lea = await connecter("cloison-a@exemple.test");
    const max = await connecter("cloison-b@exemple.test");
    const { id } = (await db.query<{ id: string }>("select * from creer_commande($1)", [commande("d", "cloison-a@exemple.test", lea)])).rows[0];
    expect(await f("lignes_commande_compte($1, $2)", [max, id])).toBeNull();
    expect(await f("lignes_commande_compte($1, $2)", [lea, id])).toHaveLength(1);
    const adresse = (await f<{ adresses: { id: string }[] }>("espace_compte($1)", [lea])).adresses[0];
    await f("supprimer_adresse($1, $2, 'ip')", [max, adresse.id]);
    expect((await f<{ adresses: unknown[] }>("espace_compte($1)", [lea])).adresses).toHaveLength(1);
  });

  it("exporte tout sans les empreintes, puis supprime le compte en gardant les commandes", async () => {
    const compte = await connecter("depart@exemple.test");
    await db.query("select * from creer_commande($1)", [commande("e", "depart@exemple.test", compte)]);
    const exp = await f<Record<string, unknown>>("export_compte($1, 'ip')", [compte]);
    expect(Object.keys(exp).sort()).toEqual(["adresses", "commandes", "compte", "export_le", "journal", "sessions"]);
    expect(JSON.stringify(exp)).not.toMatch(/[0-9a-f]{64}/);
    expect(await f<boolean>("supprimer_compte($1, $2)", [compte, h()])).toBe(true);
    const reste = (await db.query<{ n: number }>(
      "select (select count(*) from comptes where id = $1)::int + (select count(*) from sessions_compte where compte_id = $1)::int + (select count(*) from adresses_compte where compte_id = $1)::int + (select count(*) from journal_connexions where compte_id = $1)::int as n",
      [compte],
    )).rows[0];
    expect(reste.n).toBe(0);
    const c = (await db.query<{ compte_id: string | null }>("select compte_id from commandes where cle_idempotence = 'compte-e'")).rows[0];
    expect(c.compte_id).toBeNull();
  });

  it("aucun droit pour un visiteur, ni sur les tables ni sur les fonctions", async () => {
    for (const sql of [
      "select * from comptes",
      "select * from sessions_compte",
      "select * from codes_connexion",
      "select * from adresses_compte",
      "select * from journal_connexions",
      `select compte_de_session('${h()}')`,
      `select espace_compte('${"0".repeat(8)}-0000-0000-0000-000000000000')`,
    ]) {
      for (const role of ["anon", "authenticated"]) {
        await expect(
          db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query(sql);
          }),
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});

describe("recommander la même chose", () => {
  const cat: Catalogue = {
    tauxTvaPourcent: 2.6,
    groupes: {},
    plats: {
      a: { slug: "a", nom: "Plat A", categorie_slug: "x", prix_centimes: 1200, prix_a_valider: false, station: "pizza", rupture_motif: null, groupes: [], retraits: [] },
      b: { slug: "b", nom: "Plat B", categorie_slug: "x", prix_centimes: 900, prix_a_valider: false, station: "pizza", rupture_motif: "Épuisé ce soir.", groupes: [], retraits: [] },
    },
  };
  const ligne = (slug: string, unitaire: number) => ({ slug, nom: `Ancien ${slug}`, qte: 1, choix: {}, retraits: [], note: "", unitaire_centimes: unitaire });

  it("laisse de côté les plats en rupture ou retirés et signale les prix changés", () => {
    const r = recommander(cat, [ligne("a", 1100), ligne("b", 900), ligne("disparu", 500)]);
    expect(r.lignes.map((l) => l.slug)).toEqual(["a"]);
    expect(r.retirees).toEqual([
      { nom: "Ancien b", raison: "Épuisé ce soir." },
      { nom: "Ancien disparu", raison: "Ce plat n'est plus à la carte." },
    ]);
    expect(r.prix).toEqual([{ nom: "Plat A", avant_centimes: 1100, apres_centimes: 1200 }]);
  });
});
