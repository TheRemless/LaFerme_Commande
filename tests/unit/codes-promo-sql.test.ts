import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Codes promo, côté base (supabase/migrations/20261210120000_codes_promo.sql). Construits désactivés : les
// valeurs ci-dessous sont des montants d'essai posés par le test, jamais une offre de La Ferme.

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
const ESSAI = { code: "essai-1", libelle: "Essai", type: "pourcentage", valeur: 10, minimum_centimes: 0 };
async function code(p: Record<string, unknown> = {}, actif = true): Promise<string> {
  const c = await f<string>("creer_code($1, $2)", [{ ...ESSAI, ...p }, gerant]);
  if (actif) await f("modifier_code($1, $2, $3)", [c, { actif: true }, gerant]);
  return c;
}
async function interrupteur(actif: boolean) {
  await f("activer_codes_promo($1, $2)", [actif, gerant]);
}
const client = { email: "Jean.Dupont+promo@Exemple.test", telephone: "079 123 45 67", adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex", featureId: "123" } };
const evaluer = (c: string, extra: Record<string, unknown> = {}) =>
  f<Record<string, unknown>>("evaluer_code($1)", [{ code: c, ...client, mode: "livraison", sous_total_centimes: 4000, frais_centimes: 500, ...extra }]);

// Commande payée (ou dans l'état demandé) passée par creer_commande, avec ou sans code.
async function commande(opts: { email?: string; telephone?: string; adresse?: unknown; paiement?: "paye" | "aucun"; code?: string } = {}) {
  n += 1;
  const total = 1800;
  const ligne = { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "", prix_choix: {} };
  const c = (await db.query<{ id: string }>("select id from creer_commande($1)", [{
    jeton_suivi: `jeton-cp-${n}`, cle_idempotence: `cp-${n}`, mode: opts.adresse ? "livraison" : "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: `C${n}`, client_nom: "Test", client_telephone: opts.telephone ?? `078 000 00 ${String(n).padStart(2, "0")}`,
    client_email: opts.email ?? `c${n}@exemple.test`, adresse: opts.adresse ?? null,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0, total_centimes: total,
    tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000", lignes: [ligne],
  }])).rows[0];
  if (opts.paiement !== "aucun") await f("appliquer_paiement($1, $2, 'paye', 'pi_cp', $3)", [`evt-cp-${n}`, c.id, total]);
  if (opts.code) expect(await f("noter_utilisation_code($1, $2, 100)", [opts.code, c.id])).toBe(true);
  return c.id;
}

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("désactivé par défaut", () => {
  it("l'interrupteur général est faux et un code naît inactif", async () => {
    expect(await f("(select valeur from reglages where cle = 'codes_promo_actifs')")).toBe(false);
    const c = await code({}, false);
    expect(c).toBe("ESSAI-1");
    expect(await evaluer(c)).toEqual({ ok: false, raison: "desactive" });
    await interrupteur(true);
    expect(await evaluer(c)).toEqual({ ok: false, raison: "inactif" });
    await f("modifier_code($1, $2, $3)", [c, { actif: true }, gerant]);
    expect(await evaluer(c)).toMatchObject({ ok: true, remise_centimes: 400 });
    await interrupteur(false);
    expect(await evaluer(c)).toEqual({ ok: false, raison: "desactive" });
  });
});

describe("calcul de la remise", () => {
  beforeEach(() => interrupteur(true));

  it("pourcentage des plats, montant plafonné aux plats, livraison offerte", async () => {
    expect(await evaluer(await code({ code: "PCT", type: "pourcentage", valeur: 15 }), { sous_total_centimes: 3333 })).toMatchObject({ ok: true, type: "pourcentage", remise_centimes: 500 });
    const m = await code({ code: "MNT", type: "montant", valeur: 1000 });
    expect(await evaluer(m)).toMatchObject({ remise_centimes: 1000 });
    expect(await evaluer(m, { sous_total_centimes: 600 })).toMatchObject({ remise_centimes: 600 });
    const l = await code({ code: "LIV", type: "livraison", valeur: null });
    expect(await evaluer(l)).toMatchObject({ ok: true, remise_centimes: 500 });
    expect(await evaluer(l, { mode: "retrait", frais_centimes: 0, adresse: null })).toEqual({ ok: false, raison: "retrait" });
  });

  it("code inconnu, minimum, dates, casse et espaces", async () => {
    expect(await evaluer("NIMPORTE")).toEqual({ ok: false, raison: "inconnu" });
    const c = await code({ minimum_centimes: 4500 });
    expect(await evaluer(c)).toEqual({ ok: false, raison: "minimum", minimum_centimes: 4500 });
    expect(await evaluer("  essai-1 ", { sous_total_centimes: 4500 })).toMatchObject({ ok: true });
    const futur = await code({ code: "FUTUR", debut: "2999-01-01" });
    expect(await evaluer(futur)).toEqual({ ok: false, raison: "pas_commence" });
    const passe = await code({ code: "PASSE", fin: "2000-01-01" });
    expect(await evaluer(passe)).toEqual({ ok: false, raison: "expire" });
  });
});

describe("abus", () => {
  beforeEach(() => interrupteur(true));

  it("une fois par client : même e-mail (avec étiquette +), même téléphone ou même adresse", async () => {
    const c = await code();
    await commande({ email: "jean.dupont@exemple.test", code: c });
    expect(await evaluer(c)).toEqual({ ok: false, raison: "deja_utilise" });
    expect(await evaluer(c, { email: "autre@exemple.test" })).toMatchObject({ ok: true });

    const c2 = await code({ code: "TEL" });
    await commande({ telephone: "+41 79 123 45 67", code: c2 });
    expect(await evaluer(c2, { email: "autre@exemple.test" })).toEqual({ ok: false, raison: "deja_utilise" });

    const c3 = await code({ code: "ADR" });
    await commande({ adresse: { ...client.adresse, rue: "autre" }, code: c3 });
    expect(await evaluer(c3, { email: "x@exemple.test", telephone: "022 000 00 00" })).toEqual({ ok: false, raison: "deja_utilise" });
  });

  it("une commande non payée depuis plus de 30 minutes, refusée ou annulée ne compte pas", async () => {
    const c = await code();
    const id = await commande({ email: "jean.dupont@exemple.test", paiement: "aucun", code: c });
    expect(await evaluer(c)).toEqual({ ok: false, raison: "deja_utilise" });
    await db.query("update commandes set cree_le = now() - interval '31 minutes' where id = $1", [id]);
    expect(await evaluer(c)).toMatchObject({ ok: true });
  });

  it("première commande seulement : refusée à un client qui a déjà commandé", async () => {
    const c = await code({ premiere_commande: true, une_fois_par_client: false });
    expect(await evaluer(c)).toMatchObject({ ok: true });
    await commande({ telephone: "0041791234567" });
    expect(await evaluer(c)).toEqual({ ok: false, raison: "pas_premiere" });
    expect(await evaluer(c, { email: "", telephone: "" })).toEqual({ ok: false, raison: "client_inconnu" });
  });

  it("plafond d'utilisations", async () => {
    const c = await code({ plafond_utilisations: 2, une_fois_par_client: false });
    await commande({ code: c });
    await commande({ code: c });
    expect(await evaluer(c)).toEqual({ ok: false, raison: "plafond" });
  });
});

describe("back-office", () => {
  it("création, journal, chiffres par code ; type et valeur figés après usage", async () => {
    await interrupteur(true);
    const c = await code();
    const j = (await db.query<{ objet: string; cle: string }>("select objet, cle from journal_gestion where objet = 'code_promo' order by id")).rows;
    expect(j.map((x) => x.cle)).toEqual(["ESSAI-1", "ESSAI-1"]);
    await commande({ code: c });
    const g = await f<{ actifs: boolean; codes: { code: string; commandes: number; remise_centimes: number; total_centimes: number }[] }>("codes_gestion()");
    expect(g.actifs).toBe(true);
    expect(g.codes[0]).toMatchObject({ code: "ESSAI-1", commandes: 1, remise_centimes: 100, total_centimes: 1800 });
    expect(await erreur("modifier_code($1, $2, $3)", [c, { valeur: 50 }, gerant])).toContain("code_deja_utilise");
    expect(await f("modifier_code($1, $2, $3)", [c, { fin: "2999-12-31", libelle: "Flyer" }, gerant])).toBe(true);
  });

  it("refuse un code mal formé, en double, des valeurs incohérentes, un membre du service", async () => {
    expect(await erreur("creer_code($1, $2)", [{ ...ESSAI, code: "a b" }, gerant])).toContain("codes_promo_code_check");
    await code({}, false);
    expect(await erreur("creer_code($1, $2)", [ESSAI, gerant])).toContain("code_existe");
    expect(await erreur("creer_code($1, $2)", [{ ...ESSAI, code: "X100", valeur: 150 }, gerant])).toContain("check");
    expect(await erreur("creer_code($1, $2)", [{ ...ESSAI, code: "LIVV", type: "livraison", valeur: 100 }, gerant])).toContain("check");
    expect(await erreur("creer_code($1, $2)", [{ ...ESSAI, code: "DATES", debut: "2026-12-31", fin: "2026-12-01" }, gerant])).toContain("check");
    expect(await erreur("creer_code($1, $2)", [{ ...ESSAI, code: "SERV" }, service])).toContain("Réservé au gérant");
    expect(await erreur("activer_codes_promo(true, $1)", [service])).toContain("Réservé au gérant");
  });

  it("un visiteur ne lit pas les codes et n'appelle aucune fonction", async () => {
    for (const t of ["codes_promo", "utilisations_codes"]) {
      expect(await f("has_table_privilege('anon', $1, 'select')", [t])).toBe(false);
      expect(await f("has_table_privilege('authenticated', $1, 'select')", [t])).toBe(false);
    }
    for (const fn of ["evaluer_code(jsonb)", "creer_code(jsonb, uuid)", "codes_gestion()", "noter_utilisation_code(text, uuid, integer)"]) {
      expect(await f("has_function_privilege('anon', $1, 'execute')", [fn])).toBe(false);
    }
  });
});

describe("normalisation", () => {
  it("e-mail, téléphone, adresse", async () => {
    expect(await f("email_normal(' Jean.Dupont+promo@Gmail.com ')")).toBe("jean.dupont@gmail.com");
    for (const t of ["079 123 45 67", "+41 79 123 45 67", "0041791234567", "41791234567"]) expect(await f("telephone_normal($1)", [t])).toBe("41791234567");
    expect(await f("adresse_cle($1)", [{ rue: "Route de Chancy", numero: "132", npa: "1213" }])).toBe("routedechancy1321213");
    expect(await f("adresse_cle($1)", [{ rue: "x", featureId: "42" }])).toBe("egid:42");
    expect(await f("adresse_cle(null)")).toBeNull();
  });
});
