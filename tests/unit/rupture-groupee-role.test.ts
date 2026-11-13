import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// regler_rupture_groupee contrôle le rôle en base (supabase/migrations/20261212150000_rupture_groupee_role.sql) :
// service, gérant, responsable tant que role_responsable_actif ; jamais un livreur. La route l'arrête déjà
// (exigerPersonnel) : ceci est la défense en profondeur.

let db: PGlite;

async function membre(role: string, suffixe: string): Promise<string> {
  const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [
    `rupture-${suffixe}@laferme.test`,
    `Rupture ${suffixe}`,
    role,
  ]);
  return r.rows[0].id;
}
async function regler(personnel: string, jusqu: "aujourdhui" | null = "aujourdhui"): Promise<{ ok?: boolean; erreur?: string }> {
  const date = jusqu === null ? null : (await db.query<{ d: string }>("select to_char((pg_catalog.now() at time zone 'Europe/Zurich')::date, 'YYYY-MM-DD') as d")).rows[0].d;
  try {
    const r = await db.query<{ r: boolean }>("select regler_rupture_groupee('poste:pizza', $1::date, $2) as r", [date, personnel]);
    return { ok: r.rows[0].r };
  } catch (e) {
    return { erreur: e instanceof Error ? e.message : String(e) };
  }
}
async function rupturesPizza(): Promise<number> {
  return (await db.query<{ n: number }>("select count(*)::int as n from ruptures_groupees where cible = 'poste:pizza'")).rows[0].n;
}

beforeEach(async () => {
  db = await creerBaseLocale();
});

describe("regler_rupture_groupee : rôle contrôlé en base", () => {
  it("un livreur actif est refusé, rien n'est écrit (ni la rupture, ni le journal)", async () => {
    const livreur = await membre("livreur", "livreur");
    const journalAvant = (await db.query<{ n: number }>("select count(*)::int as n from journal_personnel")).rows[0].n;
    expect(await regler(livreur)).toEqual({ erreur: expect.stringContaining("droit_refuse") });
    expect(await regler(livreur, null)).toEqual({ erreur: expect.stringContaining("droit_refuse") });
    expect(await rupturesPizza()).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from journal_personnel")).rows[0].n).toBe(journalAvant);
  });

  it("le service et le gérant passent", async () => {
    expect(await regler(await membre("service", "service"))).toEqual({ ok: true });
    expect(await regler(await membre("gerant", "gerant"), null)).toEqual({ ok: true });
    expect(await rupturesPizza()).toBe(0);
  });

  it("un responsable passe tant que le rôle est activé, est refusé quand il est coupé", async () => {
    const responsable = await membre("responsable", "responsable");
    expect(await regler(responsable)).toEqual({ erreur: expect.stringContaining("droit_refuse") });
    await db.query("insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false) on conflict (cle) do update set valeur = excluded.valeur");
    expect(await regler(responsable)).toEqual({ ok: true });
    expect(await rupturesPizza()).toBe(1);
  });

  it("un membre inactif ou inconnu reste « personnel_inconnu »", async () => {
    const parti = await membre("service", "parti");
    await db.query("update personnel set actif = false where id = $1", [parti]);
    expect(await regler(parti)).toEqual({ erreur: expect.stringContaining("personnel_inconnu") });
    expect(await regler("00000000-0000-0000-0000-000000000000")).toEqual({ erreur: expect.stringContaining("personnel_inconnu") });
  });

  it("la fonction reste réservée au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ r: boolean }>(`select has_function_privilege('${role}', 'regler_rupture_groupee(text, date, uuid)', 'execute') as r`)).rows[0].r).toBe(false);
    }
  });
});
