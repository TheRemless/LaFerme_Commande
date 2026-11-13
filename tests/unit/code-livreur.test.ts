import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Connexion d'un livreur par un code affiché sur la tablette (vague 3, D13 point 3, construit désactivé).
// Cas de sécurité : réglage fermé, rôle de qui crée le code, usage unique, expiration, livreur retiré, frein.

let db: PGlite;
let gerant: string;
let service: string;
let livreur: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where role = 'service' and actif limit 1")).rows[0].id;
  livreur = (await db.query<{ id: string }>("select id from personnel where email = 'marco@laferme.test'")).rows[0].id;
});
beforeEach(async () => {
  await db.query("update reglages set valeur = 'true' where cle = 'connexion_livreur_par_code'");
  await db.query("update personnel set actif = true where id = $1", [livreur]);
});
let n = 0;
const h = (x: string) => x.padEnd(64, "0");
const ip = () => h(`ip${++n}`);
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const creer = (code: string, qui = gerant) => f<string>("creer_code_livreur($1, $2, $3)", [livreur, h(code), qui]);
const utiliser = (code: string, cleIp = ip(), session = h(`s${++n}`)) => f<{ statut: string; attente?: number }>("utiliser_code_livreur($1, $2, $3)", [h(code), cleIp, session]);

describe("code de connexion d'un livreur", () => {
  it("fermé par défaut : ni création ni usage", async () => {
    const d = await creerBaseLocale();
    const v = (await d.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = 'connexion_livreur_par_code'")).rows[0];
    expect(v).toEqual({ valeur: false, proposition: true });
    await db.query("update reglages set valeur = 'false' where cle = 'connexion_livreur_par_code'");
    await expect(creer("a1")).rejects.toThrow(/connexion_par_code_desactivee/);
    expect(await utiliser("a1")).toMatchObject({ statut: "desactive" });
  });

  it("gérant seulement (pas l'équipe de service) ; le code ouvre une session de livreur, une seule fois", async () => {
    await expect(creer("b1", service)).rejects.toThrow(/reserve_gerant/);
    const fin = await creer("b2");
    expect(new Date(fin).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const session = h("session-b2");
    expect(await utiliser("b2", ip(), session)).toMatchObject({ statut: "ok" });
    const p = await f<{ role: string; id: string } | null>("personnel_de_session($1)", [session]);
    expect(p).toMatchObject({ id: livreur, role: "livreur" });
    expect(await utiliser("b2")).toMatchObject({ statut: "invalide" });
  });

  it("expiré, remplacé par un nouveau, ou livreur retiré : refusé", async () => {
    await creer("c1");
    await db.query("update codes_livreur set expire_le = now() - interval '1 second' where code_hache = $1", [h("c1")]);
    expect(await utiliser("c1")).toMatchObject({ statut: "invalide" });
    await creer("c2");
    await creer("c3");
    expect(await utiliser("c2")).toMatchObject({ statut: "invalide" });
    await db.query("update personnel set actif = false where id = $1", [livreur]);
    expect(await utiliser("c3")).toMatchObject({ statut: "invalide" });
  });

  it("frein par connexion : après cinq codes faux, il faut attendre", async () => {
    const cle = ip();
    for (let i = 0; i < 5; i++) expect(await utiliser(`faux${i}`, cle)).toMatchObject({ statut: "invalide" });
    const r = await utiliser("faux-encore", cle);
    expect(r.statut).toBe("attente");
    expect(r.attente).toBeGreaterThan(0);
  });

  it("aucun droit pour anon ni authenticated", async () => {
    const r = (await db.query<{ r: boolean }>("select has_table_privilege('anon', 'codes_livreur', 'select') or has_function_privilege('anon', 'utiliser_code_livreur(text, text, text)', 'execute') as r")).rows[0].r;
    expect(r).toBe(false);
  });
});

describe("routes du code livreur", () => {
  it("le gérant crée le code, le livreur le tape et reçoit un cookie de 12 heures ; un faux code est refusé", async () => {
    const { baseLocale } = await import("@/lib/db/locale");
    const b = await baseLocale();
    await b.query("update reglages set valeur = 'true' where cle = 'connexion_livreur_par_code'");
    try {
      const g = (await b.query<{ id: string; email: string; nom: string }>("select id, email, nom from personnel where email = 'equipe@laferme.test'")).rows[0];
      const liv = (await b.query<{ id: string }>("select id from personnel where email = 'marco@laferme.test'")).rows[0].id;
      const { creerCodeLivreur } = await import("@/lib/personnel/code-livreur");
      const r = await creerCodeLivreur(liv, { ...g, role: "gerant" });
      expect(r.ok).toBe(true);
      const { POST } = await import("@/app/api/personnel/code-livreur/route");
      const envoyer = (code: string) =>
        POST(new Request("http://localhost:3000/api/personnel/code-livreur", { method: "POST", headers: { Origin: "http://localhost:3000", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ code }) }));
      const faux = await envoyer("00000000" === (r as { code: string }).code ? "11111111" : "00000000");
      expect(faux.status).toBe(400);
      const bon = await envoyer((r as { code: string }).code);
      expect(bon.status).toBe(200);
      const cookie = bon.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/Max-Age=43200/);
      expect(cookie).toMatch(/HttpOnly/i);
    } finally {
      await b.query("update reglages set valeur = 'false' where cle = 'connexion_livreur_par_code'");
    }
  });
});
