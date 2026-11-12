import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import type { PGlite } from "@electric-sql/pglite";

// Plafond global des codes de connexion des clients par 24 heures (décision de Jérémy du 12.11.2026, suite
// de la revue de sécurité de l'envoi par Infomaniak). Sans lui, une seule adresse IP pouvait faire partir
// 480 codes par jour et vider le quota d'envoi de la boîte du restaurant : plus de confirmation de commande
// ni de code pour l'équipe jusqu'au lendemain. Le nombre vient de la base, pas du test.

const CLE = "plafond_codes_clients_jour";
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
  await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip', 'envoi_global')");
  await db.query("update reglages set valeur = $1 where cle = $2", [plafond, CLE]);
});

let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");
// Chaque demande vient d'une autre adresse e-mail et d'une autre adresse IP : seules les limites globales jouent.
const demander = async (email = `client${n + 1}@exemple.test`, cleEmail = h(), ip = h()) =>
  (await db.query<{ r: number }>("select demander_code($1, $2, $3, $4, 'ip') as r", [email, cleEmail, ip, h()])).rows[0].r;
const demanderPersonnel = async (email: string) =>
  (await db.query<{ r: number }>("select demander_code_personnel($1, $2, $3, $4, 'ip') as r", [email, h(), h(), h()])).rows[0].r;
const compter = async (table: string, ou = "true") => (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${ou}`)).rows[0].n;
async function atteindreLePlafond() {
  for (let i = 0; i < plafond; i++) expect(await demander()).toBe(0);
}

describe("plafond global des codes clients", () => {
  it("les demandes passent jusqu'au plafond, la suivante est refusée sans créer de code", async () => {
    await atteindreLePlafond();
    const codes = await compter("codes_connexion");
    expect(await demander()).toBe(-2);
    expect(await compter("codes_connexion")).toBe(codes);
    expect(await compter("tentatives_connexion", "action = 'envoi_global'")).toBe(plafond);
  });

  it("le refus vaut aussi pour une adresse qui a déjà un compte : même réponse pour tous", async () => {
    await db.query("insert into comptes (email) values ('habitue@exemple.test') on conflict do nothing");
    await atteindreLePlafond();
    expect(await demander("habitue@exemple.test")).toBe(-2);
  });

  it("la fenêtre glisse : une demande vieille de plus de 24 heures ne compte plus", async () => {
    await atteindreLePlafond();
    expect(await demander()).toBe(-2);
    await db.query("update tentatives_connexion set le = now() - interval '25 hours' where id = (select min(id) from tentatives_connexion where action = 'envoi_global')");
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(-2);
  });

  it("une demande refusée par la limite par adresse ne consomme pas le plafond", async () => {
    const cle = h();
    const ip = h();
    expect(await demander("meme@exemple.test", cle, ip)).toBe(0);
    expect(await demander("meme@exemple.test", cle, ip)).toBeGreaterThan(0);
    expect(await compter("tentatives_connexion", "action = 'envoi_global'")).toBe(1);
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
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(0);
    expect(await demander()).toBe(-2);
  });

  it("un réglage illisible, nul ou démesuré ne lève pas le plafond et ne casse pas la connexion", async () => {
    for (const valeur of ['"abc"', "0", "-5", "1e30", "null"]) {
      await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip', 'envoi_global')");
      await db.query("update reglages set valeur = $1::jsonb where cle = $2", [valeur, CLE]);
      expect(await demander(), valeur).toBe(0);
    }
    await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip', 'envoi_global')");
    await db.query("delete from reglages where cle = $1", [CLE]);
    try {
      // Réglage absent : le plafond livré par la migration s'applique.
      await atteindreLePlafond();
      expect(await demander()).toBe(-2);
    } finally {
      await db.query("insert into reglages (cle, valeur, proposition) values ($1, $2, false)", [CLE, plafond]);
    }
  });
});

describe("côté site", () => {
  it("au plafond, la demande d'un client répond « plafond » et n'envoie rien", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "local";
    const { demanderCode } = await import("@/lib/comptes/connexion");
    await db.query("update reglages set valeur = '1' where cle = $1", [CLE]);
    expect((await demanderCode("premier@exemple.test", "203.0.113.40")).statut).toBe("envoye");
    expect(await demanderCode("second@exemple.test", "203.0.113.41")).toEqual({ statut: "plafond" });
  });
});
