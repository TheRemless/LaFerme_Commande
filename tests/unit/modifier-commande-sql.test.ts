import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes, PR B : modifier une commande acceptée sans toucher au montant (nom, téléphone,
// consignes, adresse dans la même zone). Droits revérifiés en base, tout journalisé.

let db: PGlite;
let gerant: string;
let service: string;
let livreur: string;
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
    jeton_suivi: `jeton-mod-${n}`, cle_idempotence: `mod-${n}`, mode, statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: `mod${n}@laferme.test`, quand_type: "asap",
    pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    ...(mode === "livraison" ? { adresse: ADRESSE, details_livraison: DETAILS, zone_numero: 1 } : {}),
    lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await f("appliquer_paiement($1, $2, 'paye', 'pi_mod', $3)", [`evt-${id}`, id, total]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '30 minutes')", [id]);
  return id;
}
type Resultat = { modifie: boolean; champs: string[]; avant: Record<string, unknown>; apres: Record<string, unknown> };
const modifier = (c: string, p: unknown, qui: string, de: string | null = null) =>
  f<Resultat>("modifier_commande($1, $2, $3, 'tablette:Test', $4)", [c, p, qui, de]);

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = await idPersonnel("gerant-bureau@laferme.test");
  service = await idPersonnel("equipe-bureau@laferme.test");
  livreur = await idPersonnel("marco@laferme.test");
  // Droit de l'équipe : désactivé par défaut (décision de Jérémy), activé ici pour la plupart des cas.
  await db.query("update reglages set valeur = 'true' where cle = 'modification_par_equipe'");
});

describe("modifier une commande acceptée, sans toucher au montant", () => {
  it("l'équipe corrige l'étage et le téléphone : seuls les champs changés sont gardés et journalisés", async () => {
    const c = await commande();
    const r = await modifier(c, { client_telephone: "079 555 99 99", client_prenom: "Giulia", details_livraison: { ...DETAILS, etage: "3" } }, service, "acceptee");
    expect(r.modifie).toBe(true);
    expect(r.champs).toEqual(["client_telephone", "details_livraison"]);
    const apres = (await db.query<{ client_telephone: string; details_livraison: { etage: string }; total_centimes: number }>(
      "select client_telephone, details_livraison, total_centimes from commandes where id = $1", [c])).rows[0];
    expect(apres.client_telephone).toBe("079 555 99 99");
    expect(apres.details_livraison.etage).toBe("3");
    expect(apres.total_centimes).toBe(3000);
    const j = (await db.query<{ objet: string; personnel_nom: string; avant: Record<string, unknown> }>("select objet, personnel_nom, avant from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toMatchObject({ objet: "commande", personnel_nom: "Test bureau", avant: { client_telephone: "079 555 12 34" } });
    const ev = (await db.query<{ detail: string }>("select detail from evenements_commande where commande_id = $1 order by id desc limit 1", [c])).rows[0];
    expect(ev.detail).toBe("modifiee client_telephone, details_livraison");
  });

  it("rien de changé : rien d'écrit", async () => {
    const c = await commande();
    const avant = (await db.query<{ n: number }>("select count(*)::int as n from journal_gestion")).rows[0].n;
    expect((await modifier(c, { client_nom: "Rossi" }, service)).modifie).toBe(false);
    expect((await db.query<{ n: number }>("select count(*)::int as n from journal_gestion")).rows[0].n).toBe(avant);
  });

  it("adresse dans la même zone acceptée ; autre zone refusée (frais différents)", async () => {
    const c = await commande();
    const nouvelle = { ...ADRESSE, numero: "45" };
    expect((await modifier(c, { adresse: nouvelle, zone_numero: 1 }, service)).champs).toEqual(["adresse"]);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { adresse: { ...ADRESSE, npa: "1227" }, zone_numero: 2 }, service])).toContain("zone_differente");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { adresse: nouvelle }, service])).toContain("zone_differente");
  });

  it("le livreur en route est prévenu d'un changement d'adresse", async () => {
    const c = await commande();
    await db.query("insert into livraisons (commande_id, livreur_id, attribuee_par) values ($1, $2, 'tablette:Test')", [c, livreur]);
    await modifier(c, { details_livraison: { ...DETAILS, code: "9999" } }, service);
    const j = (await db.query<{ evenement: string }>("select evenement from journal_livraisons where commande_id = $1", [c])).rows;
    expect(j.map((x) => x.evenement)).toEqual(["adresse_modifiee"]);
  });

  it("consignes ou adresse refusées sur un retrait", async () => {
    const c = await commande("retrait");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { details_livraison: DETAILS }, service])).toContain("pas_une_livraison");
  });

  it("prête ou partie : gérant seulement ; terminée ou refusée : personne", async () => {
    const c = await commande();
    await f("changer_statut($1, 'partie', 'tablette:Test')", [c]);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "Bianchi" }, service])).toContain("reserve_gerant");
    expect((await modifier(c, { client_nom: "Bianchi" }, gerant)).modifie).toBe(true);
    await f("changer_statut($1, 'terminee', 'tablette:Test')", [c]);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "Verdi" }, gerant])).toContain("statut_non_modifiable");
  });

  it("refuse un livreur, un membre retiré, un état qui a changé et un champ vide", async () => {
    const c = await commande();
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "X" }, livreur])).toContain("personnel_inactif");
    await db.query("update personnel set actif = false where id = $1", [service]);
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "X" }, service])).toContain("personnel_inactif");
    expect(await erreur("modifier_commande($1, $2, $3, 'x', 'nouvelle')", [c, { client_nom: "X" }, gerant])).toContain("deja_change");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "  " }, gerant])).toContain("champ_invalide");
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { details_livraison: { etage: "2" } }, gerant])).toContain("champ_invalide");
    // Le montant ne fait pas partie des champs modifiables : il est ignoré.
    expect((await modifier(c, { total_centimes: 1 }, gerant)).modifie).toBe(false);
  });

  it("par défaut, l'équipe ne modifie pas : gérant seulement", async () => {
    await db.query("update reglages set valeur = 'false' where cle = 'modification_par_equipe'");
    const c = await commande();
    expect(await erreur("modifier_commande($1, $2, $3, 'x')", [c, { client_nom: "Bianchi" }, service])).toContain("reserve_gerant");
    expect((await modifier(c, { client_nom: "Bianchi" }, gerant)).modifie).toBe(true);
    const r = (await db.query<{ proposition: boolean }>("select proposition from reglages where cle = 'modification_par_equipe'")).rows[0];
    expect(r.proposition).toBe(true);
  });

  it("aucun droit direct pour un visiteur", async () => {
    expect(await f("has_function_privilege('anon', 'modifier_commande(uuid, jsonb, uuid, text, text)', 'execute')")).toBe(false);
  });
});
