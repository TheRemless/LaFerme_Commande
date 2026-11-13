import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { baseLocale } from "@/lib/db/locale";
import { libelleAppareil } from "@/lib/personnel/appareil";

// Appareils connectés de l'équipe (vague 3, bo-socle) : libellé court, dernière activité, déconnexion d'un seul appareil.
describe("libellé d'un appareil", () => {
  it("dit le type d'appareil et le navigateur, rien de plus", () => {
    expect(libelleAppareil("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("iPad, Safari");
    expect(libelleAppareil("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")).toBe("Téléphone Android, Chrome");
    expect(libelleAppareil("Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")).toBe("Tablette Android, Chrome");
    expect(libelleAppareil("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("PC Windows, Edge");
    expect(libelleAppareil("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/120.0")).toBe("Mac, Firefox");
    expect(libelleAppareil(null)).toBe("Appareil");
  });
});

describe("appareils en base", () => {
  let db: PGlite;
  let gerant: string;
  let membre: string;
  const session = async (pid: string, hache: string) =>
    (await db.query<{ id: string }>("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1::uuid, $2, now() + interval '1 day') returning id::text", [pid, hache])).rows[0].id;

  beforeAll(async () => {
    db = await baseLocale();
    gerant = (await db.query<{ id: string }>("select id::text from personnel where email = 'gerant-bureau@laferme.test'")).rows[0].id;
    membre = (await db.query<{ id: string }>("select id::text from personnel where email = 'cuisine-bureau@laferme.test'")).rows[0].id;
    await db.query("delete from sessions_personnel where jeton_hache like 'appareil-test-%'");
  });

  it("note l'appareil à la connexion et la dernière activité au plus toutes les cinq minutes", async () => {
    await session(membre, "appareil-test-1");
    await db.query("select noter_appareil_personnel('appareil-test-1', 'iPad, Safari')");
    await db.query("update sessions_personnel set vue_le = now() - interval '10 minutes' where jeton_hache = 'appareil-test-1'");
    await db.query("select voir_session_personnel('appareil-test-1')");
    const v1 = (await db.query<{ v: string }>("select vue_le::text as v from sessions_personnel where jeton_hache = 'appareil-test-1'")).rows[0].v;
    await db.query("select voir_session_personnel('appareil-test-1')");
    const v2 = (await db.query<{ v: string }>("select vue_le::text as v from sessions_personnel where jeton_hache = 'appareil-test-1'")).rows[0].v;
    expect(v2).toBe(v1);
    const liste = (await db.query<{ r: { appareil: string; actuel: boolean }[] }>("select appareils_personnel($1::uuid, $2::uuid, 'autre') as r", [membre, gerant])).rows[0].r;
    expect(liste.find((a) => a.appareil === "iPad, Safari")?.actuel).toBe(false);
  });

  it("le gérant coupe un seul appareil, journalisé ; l'équipe de service ne peut ni lister ni couper", async () => {
    const a = await session(membre, "appareil-test-2");
    await session(membre, "appareil-test-3");
    await expect(db.query("select appareils_personnel($1::uuid, $2::uuid, '')", [membre, membre])).rejects.toThrow(/Réservé au gérant/);
    await expect(db.query("select couper_appareil_personnel($1::uuid, $2::uuid)", [a, membre])).rejects.toThrow(/Réservé au gérant/);
    expect((await db.query<{ r: boolean }>("select couper_appareil_personnel($1::uuid, $2::uuid) as r", [a, gerant])).rows[0].r).toBe(true);
    expect((await db.query<{ r: boolean }>("select couper_appareil_personnel($1::uuid, $2::uuid) as r", [a, gerant])).rows[0].r).toBe(false);
    const restants = (await db.query<{ n: number }>("select count(*)::int as n from sessions_personnel where jeton_hache in ('appareil-test-2', 'appareil-test-3') and revoquee_le is null")).rows[0].n;
    expect(restants).toBe(1);
    const j = await db.query<{ apres: { sessions_coupees: number } }>("select apres from journal_gestion where objet = 'personnel' and cle = 'cuisine-bureau@laferme.test' order by id desc limit 1");
    expect(j.rows[0].apres.sessions_coupees).toBe(1);
    await db.query("delete from sessions_personnel where jeton_hache like 'appareil-test-%'");
  });
});
