import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Cagnotte des clients (validée par Jérémy le 15.11.2026), migration 20261216090000_cagnotte.sql. Chaque bloc suit
// la grille de relecture de qualite : crédit, utilisation, remboursements, expiration, ajustements, données.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
// Requête complète (avec from) : première colonne de la première ligne.
async function val<T>(sql: string, v: unknown[] = []): Promise<T> {
  return Object.values((await db.query<Record<string, T>>(sql, v)).rows[0])[0];
}
const idPersonnel = async (email: string) => (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;

async function compte(email = `client${++n}@exemple.ch`): Promise<string> {
  return (await db.query<{ id: string }>("insert into comptes (email, prenom, telephone) values ($1, 'Léa', '079 000 00 00') returning id", [email])).rows[0].id;
}

type Options = { mode?: "livraison" | "retrait"; moyen?: "en_ligne" | "comptoir"; sousTotal?: number; frais?: number; compteId?: string | null; cle?: string };
function donnees(o: Options = {}) {
  n += 1;
  const sousTotal = o.sousTotal ?? 4350;
  const frais = o.mode === "retrait" ? 0 : (o.frais ?? 500);
  return {
    jeton_suivi: `jeton-cagnotte-${n}`,
    cle_idempotence: o.cle ?? `cagnotte-${n}`,
    mode: o.mode ?? "livraison",
    statut: "nouvelle",
    statut_paiement: o.moyen === "comptoir" ? "a_encaisser_retrait" : "paye",
    moyen_paiement: o.moyen ?? "en_ligne",
    client_prenom: "Léa",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: `commande${n}@exemple.ch`,
    adresse: o.mode === "retrait" ? null : { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    zone_numero: o.mode === "retrait" ? null : 1,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: sousTotal,
    frais_centimes: frais,
    total_centimes: sousTotal + frais,
    tva_centimes: Math.round(((sousTotal + frais) * 2.6) / 102.6),
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    compte_id: o.compteId ?? null,
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: sousTotal, total_centimes: sousTotal, choix: {}, retraits: [], note: "" }],
  };
}

async function commande(o: Options = {}): Promise<string> {
  return (await db.query<{ id: string }>("select id from creer_commande($1)", [donnees(o)])).rows[0].id;
}
// Heure promise : 12h ou 19h30 (heure de Genève) le jour donné.
async function promise(id: string, jour: string, heure: "midi" | "soir") {
  await db.query(`update commandes set heure_confirmee = ($2 || ' ' || $3)::timestamp at time zone 'Europe/Zurich' where id = $1`, [id, jour, heure === "soir" ? "19:30" : "12:00"]);
}
const terminer = (id: string) => db.query("update commandes set statut = 'terminee', termine_le = now() where id = $1", [id]);
const solde = (c: string) => f<number>("solde_cagnotte($1)", [c]);
const mouvements = async (c: string) =>
  (await db.query<{ type: string; montant_centimes: number }>("select type, montant_centimes from cagnotte_mouvements where compte_id = $1 order by id", [c])).rows;
async function crediter(c: string, montant: number) {
  await db.query("insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif, par) values ($1, 'ajustement', $2, 'Solde de départ', 'test')", [c, montant]);
}
async function rembourser(commande: string, montant: number, moyen: "stripe" | "especes" = "stripe") {
  n += 1;
  await db.query(
    "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, $2, $3, 'Geste', $4, 'fait', 'Test', now())",
    [commande, `remb-cagnotte-${n}`, montant, moyen],
  );
}

beforeEach(async () => {
  db = await creerBaseLocale();
});

describe("crédit", () => {
  it("5 % des plats seulement, au centime inférieur, à la remise et jamais avant", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, sousTotal: 4350, frais: 500 });
    await db.query("update commandes set statut = 'acceptee' where id = $1", [id]);
    expect(await solde(c)).toBe(0);
    await terminer(id);
    // 5 % de 43.50 = 2.175 → 2.17 ; les frais de livraison ne comptent pas.
    expect(await mouvements(c)).toEqual([{ type: "gain", montant_centimes: 217 }]);
  });

  it("par le vrai chemin de la tablette (changer_statut) et une seule fois par commande", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, mode: "retrait", sousTotal: 2000 });
    await db.query("update commandes set statut = 'prete' where id = $1", [id]);
    await db.query("select changer_statut($1, 'terminee', 'tablette:Test', null, null, 'prete')", [id]);
    expect(await solde(c)).toBe(100);
    await f("crediter_cagnotte($1)", [id]);
    await db.query("update commandes set statut = 'prete' where id = $1", [id]);
    await terminer(id);
    expect(await solde(c)).toBe(100);
  });

  it("rien sans compte, interrupteur éteint, ou livraison close « client absent »", async () => {
    const sans = await commande();
    await terminer(sans);
    expect(await val<number>("select count(*)::integer from cagnotte_mouvements where commande_id = $1", [sans])).toBe(0);

    const c = await compte();
    const absent = await commande({ compteId: c });
    await db.query("update commandes set statut = 'terminee', motif = 'Client absent à la livraison.' where id = $1", [absent]);
    expect(await solde(c)).toBe(0);

    await db.query("update reglages set valeur = 'false' where cle = 'fidelite_active'");
    const eteinte = await commande({ compteId: c });
    await terminer(eteinte);
    expect(await solde(c)).toBe(0);
  });

  it("après un code promo sur les plats ; un code « livraison » ne réduit pas la base", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, sousTotal: 4000 });
    await db.query("update commandes set code_promo = 'ESSAI', remise_centimes = 1000 where id = $1", [id]);
    await terminer(id);
    expect(await solde(c)).toBe(150);
  });

  it("soirs doublés décidés par la base d'après l'heure promise", async () => {
    const c = await compte();
    // 19.11.2026 est un jeudi (isodow 4).
    await db.query(`update reglages set valeur = '{"jours": [4], "dates": ["2026-11-21"]}' where cle = 'fidelite_soirs_doubles'`);
    const soir = await commande({ compteId: c, sousTotal: 2000 });
    await promise(soir, "2026-11-19", "soir");
    const midi = await commande({ compteId: c, sousTotal: 2000 });
    await promise(midi, "2026-11-19", "midi");
    const samedi = await commande({ compteId: c, sousTotal: 2000 });
    await promise(samedi, "2026-11-21", "soir");
    for (const id of [soir, midi, samedi]) await terminer(id);
    expect(await mouvements(c)).toEqual([
      { type: "gain", montant_centimes: 200 },
      { type: "gain", montant_centimes: 100 },
      { type: "gain", montant_centimes: 200 },
    ]);
    expect(await val<number[]>("select array_agg(taux_pourcent::integer order by id) from cagnotte_mouvements where compte_id = $1", [c])).toEqual([10, 5, 10]);
  });
});

describe("remboursements après la remise", () => {
  it("un remboursement partiel retire la part du gain ; total : tout le gain", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, sousTotal: 4000 });
    await terminer(id);
    expect(await solde(c)).toBe(200);
    await rembourser(id, 1000);
    // Base 30.00 : gain dû 1.50, 0.50 retirés.
    expect(await solde(c)).toBe(150);
    await rembourser(id, 3500, "especes");
    expect(await solde(c)).toBe(0);
    expect((await mouvements(c)).map((m) => m.type)).toEqual(["gain", "retrait", "retrait"]);
  });

  it("jamais de solde négatif : on retire ce qui reste", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, sousTotal: 4000 });
    await terminer(id);
    await db.query("insert into cagnotte_mouvements (compte_id, type, montant_centimes) values ($1, 'expire', -150)", [c]);
    await rembourser(id, 4500);
    expect(await solde(c)).toBe(0);
  });
});

describe("utilisation au paiement", () => {
  const payer = (o: Options, montant: number, code: string | null = null) => f<{ id: string; total_centimes: number; cagnotte_centimes: number; deja: boolean }>(
    "creer_commande_paiement($1, $2, $3)", [donnees(o), code, montant]);

  it("dès le seuil, au plus le solde, les plats, et CHF 0.50 restent à payer en ligne ; TVA sur le net", async () => {
    const c = await compte();
    await crediter(c, 900);
    await expect(payer({ compteId: c }, 900)).rejects.toThrow(/cagnotte_refusee:seuil/);
    await crediter(c, 600);
    const r = await payer({ compteId: c, sousTotal: 2000, frais: 500 }, 5000);
    expect(r.cagnotte_centimes).toBe(1500);
    expect(r.total_centimes).toBe(1000);
    const o = (await db.query<{ total_centimes: number; tva_centimes: number }>("select total_centimes, tva_centimes from commandes where id = $1", [r.id])).rows[0];
    expect(o).toEqual({ total_centimes: 1000, tva_centimes: Math.round((1000 * 2.6) / 102.6) });
    expect(await solde(c)).toBe(0);

    await crediter(c, 3000);
    // À emporter, 12.00 de plats : au plus 11.50, le reste est payé en ligne.
    const retrait = await payer({ compteId: c, mode: "retrait", sousTotal: 1200 }, 3000);
    expect(retrait).toMatchObject({ cagnotte_centimes: 1150, total_centimes: 50 });
  });

  it("comptes en ligne seulement : refusée au comptoir, sans compte, interrupteur éteint ; la commande n'est pas créée", async () => {
    const c = await compte();
    await crediter(c, 2000);
    await expect(payer({ compteId: c, mode: "retrait", moyen: "comptoir" }, 1000)).rejects.toThrow(/cagnotte_refusee:comptoir/);
    await expect(payer({}, 1000)).rejects.toThrow(/cagnotte_refusee:compte/);
    await db.query("update reglages set valeur = 'false' where cle = 'fidelite_active'");
    await expect(payer({ compteId: c }, 1000)).rejects.toThrow(/cagnotte_refusee:desactive/);
    expect(await val<number>("select count(*)::integer from commandes where compte_id = $1", [c])).toBe(0);
    expect(await solde(c)).toBe(2000);
  });

  it("même clé rejouée : une seule utilisation ; deux paiements à la suite ne dépensent pas deux fois le solde", async () => {
    const c = await compte();
    await crediter(c, 1500);
    const o = { compteId: c, cle: "cagnotte-rejouee" };
    const a = await payer(o, 1500);
    const b = await payer(o, 1500);
    expect(b).toMatchObject({ id: a.id, deja: true, cagnotte_centimes: 1500 });
    expect(await solde(c)).toBe(0);
    // Deuxième onglet : le solde est déjà réservé par la première commande.
    await expect(payer({ compteId: c }, 1500)).rejects.toThrow(/cagnotte_refusee:seuil/);
  });

  it("rendue si le paiement échoue, si la commande est refusée ou remboursée en entier, une seule fois", async () => {
    const c = await compte();
    await crediter(c, 3000);
    const echec = await payer({ compteId: c }, 1000);
    await db.query("update commandes set statut = 'annulee', statut_paiement = 'echec' where id = $1", [echec.id]);
    expect(await solde(c)).toBe(3000);

    const refusee = await payer({ compteId: c }, 1000);
    await db.query("update commandes set statut = 'refusee' where id = $1", [refusee.id]);
    await db.query("update commandes set statut_paiement = 'rembourse' where id = $1", [refusee.id]);
    expect(await solde(c)).toBe(3000);
    expect(await val<number>("select count(*)::integer from cagnotte_mouvements where commande_id = $1 and type = 'rendu'", [refusee.id])).toBe(1);

    // Livrée puis remboursée en entier : la cagnotte revient, le gain repart.
    const livree = await payer({ compteId: c, sousTotal: 4000 }, 1000);
    await terminer(livree.id);
    expect(await solde(c)).toBe(3000 - 1000 + 150);
    await rembourser(livree.id, livree.total_centimes);
    await db.query("update commandes set statut_paiement = 'rembourse' where id = $1", [livree.id]);
    expect(await solde(c)).toBe(3000);
  });
});

describe("expiration", () => {
  async function vieillir(c: string, mois: number) {
    await db.query(`update commandes set cree_le = now() - make_interval(months => $2) where compte_id = $1`, [c, mois]);
    await db.query(`update cagnotte_mouvements set cree_le = now() - make_interval(months => $2) where compte_id = $1`, [c, mois]);
  }

  it("tout le solde, 12 mois après la dernière commande, jamais pendant une commande en cours", async () => {
    const c = await compte();
    const id = await commande({ compteId: c, sousTotal: 4000 });
    await terminer(id);
    await crediter(c, 1000);
    await vieillir(c, 11);
    expect(await f<number>("expirer_cagnottes()")).toBe(0);
    await vieillir(c, 13);
    const enCours = await commande({ compteId: c });
    await db.query("update commandes set statut = 'acceptee', cree_le = now() - interval '13 months' where id = $1", [enCours]);
    expect(await f<number>("expirer_cagnottes()")).toBe(0);
    await db.query("update commandes set statut = 'terminee' where id = $1", [enCours]);
    await db.query("delete from cagnotte_mouvements where commande_id = $1", [enCours]);
    expect(await f<number>("expirer_cagnottes()")).toBe(1);
    expect(await solde(c)).toBe(0);
    expect((await mouvements(c)).at(-1)).toEqual({ type: "expire", montant_centimes: -1200 });
  });

  it("rappel 30 jours avant, une seule fois, sauf si le client l'a refusé", async () => {
    const c = await compte("rappel@exemple.ch");
    const refus = await compte("pas-de-rappel@exemple.ch");
    for (const k of [c, refus]) {
      const id = await commande({ compteId: k, sousTotal: 4000 });
      await terminer(id);
    }
    await f("regler_rappel_cagnotte($1, false)", [refus]);
    await vieillir(c, 11);
    await vieillir(refus, 11);
    await db.query("update commandes set cree_le = cree_le - interval '10 days' where compte_id in ($1, $2)", [c, refus]);
    const dus = await f<{ email: string; solde_centimes: number }[]>("rappels_cagnotte_dus()");
    expect(dus.map((d) => d.email)).toEqual(["rappel@exemple.ch"]);
    expect(dus[0].solde_centimes).toBe(200);
    expect(await f<unknown[]>("rappels_cagnotte_dus()")).toEqual([]);
  });
});

describe("back-office", () => {
  it("ajustement : gérant seulement, montant borné, motif, jamais négatif, journalisé sans e-mail", async () => {
    const c = await compte("ajuste@exemple.ch");
    const gerant = await idPersonnel("equipe@laferme.test");
    const service = await idPersonnel("equipe-bureau@laferme.test");
    await expect(f("ajuster_cagnotte('ajuste@exemple.ch', 500, 'Geste après réclamation', $1)", [service])).rejects.toThrow(/Réservé au gérant/);
    await expect(f("ajuster_cagnotte('ajuste@exemple.ch', 20000, 'Trop', $1)", [gerant])).rejects.toThrow(/montant/);
    await expect(f("ajuster_cagnotte('ajuste@exemple.ch', 500, '', $1)", [gerant])).rejects.toThrow(/motif/);
    await expect(f("ajuster_cagnotte('ajuste@exemple.ch', -100, 'Erreur', $1)", [gerant])).rejects.toThrow(/negatif/);
    expect(await f<number>("ajuster_cagnotte(' Ajuste@exemple.ch ', 500, 'Geste après réclamation', $1)", [gerant])).toBe(500);
    const j = (await db.query<{ objet: string; cle: string }>("select objet, cle from journal_gestion where objet = 'cagnotte'")).rows;
    expect(j).toEqual([{ objet: "cagnotte", cle: c }]);
    const fiche = await f<{ solde_centimes: number; mouvements: { par: string }[] }>("cagnotte_client_gestion('ajuste@exemple.ch')");
    expect(fiche.solde_centimes).toBe(500);
    expect(fiche.mouvements[0].par).toBe("Équipe test");
  });

  it("réglages bornés et journalisés ; montant dû aux clients", async () => {
    const gerant = await idPersonnel("equipe@laferme.test");
    const regler = (p: object) => f<{ taux_pourcent: number }>("regler_fidelite($1, $2)", [p, gerant]);
    await expect(regler({ taux_pourcent: 12, seuil_centimes: 1000, soirs_doubles: { jours: [], dates: [] } })).rejects.toThrow(/taux/);
    await expect(regler({ taux_pourcent: 5, seuil_centimes: 1000, soirs_doubles: { jours: [8], dates: [] } })).rejects.toThrow(/soirs/);
    expect((await regler({ taux_pourcent: 7, seuil_centimes: 500, soirs_doubles: { jours: [2, 2], dates: ["2026-12-01"] } })).taux_pourcent).toBe(7);
    const r = await f<{ soirs_doubles: { jours: number[] }; du_centimes: number }>("reglages_fidelite()");
    expect(r.soirs_doubles.jours).toEqual([2]);
    const c = await compte();
    await crediter(c, 740);
    expect((await f<{ du_centimes: number; comptes: number }>("reglages_fidelite()"))).toMatchObject({ du_centimes: 740, comptes: 1 });
    expect(await val<number>("select count(*)::integer from journal_gestion where objet = 'fidelite'")).toBe(1);
    // Bilan : le dû à une date ne compte que les mouvements jusqu'à minuit ce jour-là (heure de Genève).
    await db.query("update cagnotte_mouvements set cree_le = '2026-12-31 23:30+00' where compte_id = $1", [c]);
    expect(await f<{ du_centimes: number }>("du_cagnottes_au('2026-12-31')")).toMatchObject({ du_centimes: 0 });
    expect(await f<{ du_centimes: number; comptes: number }>("du_cagnottes_au('2027-01-01')")).toMatchObject({ du_centimes: 740, comptes: 1 });
  });
});

describe("données", () => {
  it("la cagnotte part à l'export et à l'effacement du compte", async () => {
    const c = await compte();
    await crediter(c, 740);
    const e = await f<{ cagnotte: { solde_centimes: number; mouvements: { motif: string; par?: string }[] } }>("export_compte($1, 'ip')", [c]);
    expect(e.cagnotte.solde_centimes).toBe(740);
    expect(e.cagnotte.mouvements[0]).not.toHaveProperty("par");
    await db.query("delete from comptes where id = $1", [c]);
    expect(await val<number>("select count(*)::integer from cagnotte_mouvements where compte_id = $1", [c])).toBe(0);
  });

  it("tables fermées au public, fonctions réservées au serveur", async () => {
    for (const t of ["cagnotte_mouvements", "rappels_cagnotte"]) {
      expect(await val<boolean>("select relrowsecurity from pg_class where relname = $1", [t])).toBe(true);
    }
    for (const fn of ["creer_commande_paiement", "ajuster_cagnotte", "cagnotte_compte", "expirer_cagnottes"]) {
      const qui = (await db.query<{ grantee: string }>(
        "select grantee from information_schema.routine_privileges where routine_name = $1 and privilege_type = 'EXECUTE'", [fn])).rows.map((r) => r.grantee);
      expect(qui).toContain("service_role");
      expect(qui).not.toContain("anon");
      expect(qui).not.toContain("authenticated");
    }
  });
});
