import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Responsable de service sur la tablette (vague 3, D1 ; migration 20261213220000_tablette_responsable.sql) :
// il annule une livraison partie et modifie une commande, comme le gérant, tant que son rôle est ouvert.
// L'équipe de service reste refusée ; rôle éteint, le responsable redevient un membre de l'équipe.

let db: PGlite;
let gerant: string;
let service: string;
let responsable: string;
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
async function idPersonnel(email: string): Promise<string> {
  return (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
}
const ADRESSE = { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" };
const DETAILS = { sonnette: "Rossi", etage: "2", code: "1234", instructions: "" };

async function commande(mode: "livraison" | "retrait" = "livraison"): Promise<string> {
  n += 1;
  const total = 3000;
  const p = {
    jeton_suivi: `jeton-resp-${n}`, cle_idempotence: `resp-${n}`, mode, statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: `resp${n}@laferme.test`, quand_type: "asap",
    pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    ...(mode === "livraison" ? { adresse: ADRESSE, details_livraison: DETAILS, zone_numero: 1 } : {}),
    lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await f("appliquer_paiement($1, $2, 'paye', 'pi_resp', $3)", [`evt-${id}`, id, total]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '30 minutes')", [id]);
  return id;
}
type Resultat = { modifie: boolean; champs: string[]; avant: Record<string, unknown>; apres: Record<string, unknown> };
const modifier = (c: string, p: unknown, qui: string, de: string | null = null) =>
  f<Resultat>("modifier_commande($1, $2, $3, 'tablette:Test', $4)", [c, p, qui, de]);

const annulerPartie = (c: string, qui: string) => f<boolean>("annuler_commande_partie($1, 'tablette:Test', 'Adresse introuvable', $2)", [c, qui]);
const partie = async (c: string) => db.query("update commandes set statut = 'partie' where id = $1", [c]);
const statut = async (c: string) => (await db.query<{ statut: string }>("select statut from commandes where id = $1", [c])).rows[0].statut;
const roleResponsable = (actif: boolean) => db.query(`update reglages set valeur = '${actif}' where cle = 'role_responsable_actif'`);

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = await idPersonnel("gerant-bureau@laferme.test");
  service = await idPersonnel("equipe-bureau@laferme.test");
  responsable = await idPersonnel("responsable-tablette-bureau@laferme.test");
  await roleResponsable(true);
  await db.query("update reglages set valeur = 'false' where cle = 'modification_par_equipe'");
});

describe("responsable de service sur la tablette", () => {
  it("annule une livraison partie, comme le gérant ; l'équipe de service reste refusée", async () => {
    const a = await commande();
    await partie(a);
    expect(await erreur("annuler_commande_partie($1, 'tablette:Test', 'Adresse introuvable', $2)", [a, service])).toMatch(/droit_refuse/);
    expect(await statut(a)).toBe("partie");
    expect(await annulerPartie(a, responsable)).toBe(true);
    expect(await statut(a)).toBe("refusee");
    const b = await commande();
    await partie(b);
    expect(await annulerPartie(b, gerant)).toBe(true);
  });

  it("rôle éteint : le responsable ne peut plus annuler une livraison partie", async () => {
    await roleResponsable(false);
    const a = await commande();
    await partie(a);
    expect(await erreur("annuler_commande_partie($1, 'tablette:Test', 'Adresse introuvable', $2)", [a, responsable])).toMatch(/droit_refuse/);
    expect(await statut(a)).toBe("partie");
  });

  it("modifie une commande sans le réglage de l'équipe, même prête ; l'équipe reste refusée", async () => {
    const a = await commande();
    expect(await erreur("modifier_commande($1, $2, $3, 'tablette:Test', null)", [a, { client_prenom: "Luca" }, service])).toMatch(/reserve_gerant/);
    expect(await modifier(a, { client_prenom: "Luca" }, responsable)).toMatchObject({ modifie: true });
    await db.query("update commandes set statut = 'prete' where id = $1", [a]);
    expect(await modifier(a, { client_prenom: "Marco" }, responsable)).toMatchObject({ modifie: true });
  });

  it("rôle éteint : le responsable suit la règle de l'équipe", async () => {
    await roleResponsable(false);
    const a = await commande();
    expect(await erreur("modifier_commande($1, $2, $3, 'tablette:Test', null)", [a, { client_prenom: "Luca" }, responsable])).toMatch(/reserve_gerant/);
    await db.query("update reglages set valeur = 'true' where cle = 'modification_par_equipe'");
    expect(await modifier(a, { client_prenom: "Luca" }, responsable)).toMatchObject({ modifie: true });
    await db.query("update commandes set statut = 'prete' where id = $1", [a]);
    expect(await erreur("modifier_commande($1, $2, $3, 'tablette:Test', null)", [a, { client_prenom: "Marco" }, responsable])).toMatch(/reserve_gerant/);
  });
});
