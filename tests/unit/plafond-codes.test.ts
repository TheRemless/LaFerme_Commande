import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import type { PGlite } from "@electric-sql/pglite";

// Plafond global des codes de connexion des clients par 24 heures (décision de Jérémy du 12.11.2026, suite
// de la revue de sécurité de l'envoi par Infomaniak). Sans lui, une seule adresse IP pouvait faire partir
// 480 codes par jour et vider le quota d'envoi de la boîte du restaurant : plus de confirmation de commande
// ni de code pour l'équipe jusqu'au lendemain. Le plafond vient de la base, pas du test.

const CLE = "plafond_codes_clients_jour";
const COMPTEURS = "delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip', 'envoi_global')";
let db: PGlite;
let plafond: number;
beforeAll(async () => {
  db = await baseLocale();
  const r = await db.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = $1", [CLE]);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].proposition).toBe(false);
  plafond = Number(r.rows[0].valeur);
  expect(Number.isInteger(plafond) && plafond >= 50).toBe(true);
});
beforeEach(async () => {
  await db.query(COMPTEURS);
  await db.query("update reglages set valeur = $1 where cle = $2", [plafond, CLE]);
});

let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");
// Par défaut, chaque demande vient d'une autre adresse e-mail et d'une autre adresse IP : seul le plafond global joue.
const demander = async (email = `client${n + 1}@exemple.test`, cleEmail = h(), ip = h()) =>
  (await db.query<{ r: number }>("select demander_code($1, $2, $3, $4, 'ip') as r", [email, cleEmail, ip, h()])).rows[0].r;
const demanderPersonnel = async (email: string) =>
  (await db.query<{ r: number }>("select demander_code_personnel($1, $2, $3, $4, 'ip') as r", [email, h(), h(), h()])).rows[0].r;
const compter = async (table: string, ou = "true") => (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${ou}`)).rows[0].n;
const comptes = "action = 'envoi_global' and cle = 'codes_clients'";
const plafondLu = async () => (await db.query<{ p: number }>("select plafond_codes_clients() as p")).rows[0].p;
async function atteindreLePlafond() {
  for (let i = 0; i < plafond; i++) expect(await demander()).toBe(0);
}

describe("plafond global des codes clients", () => {
  it("les demandes passent jusqu'au plafond, les suivantes sont refusées sans créer de code", async () => {
    await atteindreLePlafond();
    const codes = await compter("codes_connexion");
    // Premier refus : -3, le site prévient le restaurant. Ensuite -2, sans nouvelle alerte.
    expect(await demander()).toBe(-3);
    expect(await demander()).toBe(-2);
    expect(await demander()).toBe(-2);
    expect(await compter("codes_connexion")).toBe(codes);
    expect(await compter("tentatives_connexion", comptes)).toBe(plafond);
    expect(await compter("tentatives_connexion", "action = 'envoi_global' and cle = 'alerte_plafond'")).toBe(1);
  });

  it("au plafond, même réponse pour un compte existant, une adresse inconnue et une adresse qui vient de demander", async () => {
    await db.query("insert into comptes (email) values ('habitue@exemple.test') on conflict do nothing");
    const cle = h();
    const ip = h();
    expect(await demander("recent@exemple.test", cle, ip)).toBe(0);
    for (let i = 1; i < plafond; i++) expect(await demander()).toBe(0);
    expect(await demander()).toBe(-3);
    expect(await demander("habitue@exemple.test")).toBe(-2);
    // Sans le plafond, cette adresse recevrait « attendez 30 secondes » : au plafond, rien ne la distingue.
    expect(await demander("recent@exemple.test", cle, ip)).toBe(-2);
  });

  it("la fenêtre glisse : une demande vieille de plus de 24 heures ne compte plus, et l'alerte peut repartir", async () => {
    await atteindreLePlafond();
    expect(await demander()).toBe(-3);
    await db.query(`update tentatives_connexion set le = now() - interval '25 hours' where id = (select min(id) from tentatives_connexion where ${comptes})`);
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(-2);
    await db.query("update tentatives_connexion set le = now() - interval '25 hours' where action = 'envoi_global' and cle = 'alerte_plafond'");
    expect(await demander()).toBe(-3);
  });

  it("une demande refusée par la limite par adresse ne consomme pas le plafond", async () => {
    const cle = h();
    const ip = h();
    expect(await demander("meme@exemple.test", cle, ip)).toBe(0);
    expect(await demander("meme@exemple.test", cle, ip)).toBeGreaterThan(0);
    expect(await compter("tentatives_connexion", comptes)).toBe(1);
  });

  it("une seule adresse IP ne prend qu'une part du plafond : 20 codes par heure, 30 par 24 heures", async () => {
    const ip = h();
    for (let i = 0; i < 20; i++) expect(await demander(undefined, h(), ip)).toBe(0);
    expect(await demander(undefined, h(), ip)).toBeGreaterThan(0);
    // Deux heures plus tard, la limite horaire est levée, celle des 24 heures compte toujours.
    await db.query("update tentatives_connexion set le = le - interval '2 hours' where action = 'envoi_ip' and cle = $1", [ip]);
    for (let i = 0; i < 10; i++) expect(await demander(undefined, h(), ip)).toBe(0);
    await db.query("update tentatives_connexion set le = le - interval '2 hours' where action = 'envoi_ip' and cle = $1", [ip]);
    const attente = await demander(undefined, h(), ip);
    expect(attente).toBeGreaterThan(3600);
    expect(await compter("tentatives_connexion", comptes)).toBe(30);
    expect(30).toBeLessThan(plafond);
    // Une autre adresse IP n'est pas touchée.
    expect(await demander()).toBe(0);
  });

  it("l'équipe garde ses codes quand le plafond des clients est atteint, et ne le consomme pas", async () => {
    for (let i = 0; i < 5; i++) await demanderPersonnel(`inconnu${i}@exemple.test`);
    expect(await demanderPersonnel("equipe@laferme.test")).toBe(0);
    expect(await compter("tentatives_connexion", "action = 'envoi_global'")).toBe(0);
    await atteindreLePlafond();
    await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip')");
    expect(await demanderPersonnel("equipe@laferme.test")).toBe(0);
  });

  it("le plafond se change dans les réglages de la base, sans nouvelle version du site", async () => {
    await db.query("update reglages set valeur = '2' where cle = $1", [CLE]);
    expect(await plafondLu()).toBe(2);
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(-3);
  });

  it("un réglage illisible, nul, absent ou démesuré ne lève pas le plafond et ne casse pas la connexion", async () => {
    // Illisible ou inférieur à 1 : le plafond livré par la migration s'applique.
    for (const valeur of ['"abc"', "0", "-5", "null", "true", "[200]"]) {
      await db.query("update reglages set valeur = $1::jsonb where cle = $2", [valeur, CLE]);
      expect(await plafondLu(), valeur).toBe(plafond);
    }
    await db.query("update reglages set valeur = '2.7' where cle = $1", [CLE]);
    expect(await plafondLu()).toBe(2);
    // Démesuré : borné, sans erreur de dépassement d'entier.
    await db.query("update reglages set valeur = '1e30' where cle = $1", [CLE]);
    const borne = await plafondLu();
    expect(Number.isInteger(borne) && borne >= plafond && borne <= 100000).toBe(true);
    expect(await demander()).toBe(0);
    await db.query(COMPTEURS);
    await db.query("delete from reglages where cle = $1", [CLE]);
    try {
      expect(await plafondLu()).toBe(plafond);
      await atteindreLePlafond();
      expect(await demander()).toBe(-3);
    } finally {
      await db.query("insert into reglages (cle, valeur, proposition) values ($1, $2, false)", [CLE, plafond]);
    }
  });
});

describe("côté site", () => {
  it("au plafond, la demande d'un client répond « plafond », ne crée pas de code et prévient le restaurant une fois", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "local";
    delete process.env.SMTP_UTILISATEUR;
    const { demanderCode } = await import("@/lib/comptes/connexion");
    const alertes = () => compter("courriels", "commande_id is null and sujet like 'Codes de connexion des clients%'");
    await db.query("update reglages set valeur = '1' where cle = $1", [CLE]);
    const avant = await alertes();
    expect((await demanderCode("premier@exemple.test", "203.0.113.40")).statut).toBe("envoye");
    const codes = await compter("codes_connexion");
    expect(await demanderCode("second@exemple.test", "203.0.113.41")).toEqual({ statut: "plafond" });
    expect(await demanderCode("troisieme@exemple.test", "203.0.113.42")).toEqual({ statut: "plafond" });
    expect(await compter("codes_connexion")).toBe(codes);
    expect(await alertes()).toBe(avant + 1);
  });
});
