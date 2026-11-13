import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { libelleAppareil } from "@/lib/comptes/appareil";
import { baseLocale } from "@/lib/db/locale";
import { fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-compte : le client voit les appareils connectés à son compte et en déconnecte un seul.
// Le nom de l'appareil est court (« Safari sur iPhone ») : ni version, ni modèle, ni adresse IP.

describe("nom lisible d'un appareil", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari sur iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1", "Chrome sur iPhone"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36", "Chrome sur Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari sur Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0", "Edge sur Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox sur Linux"],
    ["", "Navigateur inconnu"],
  ])("%s", (ua, attendu) => {
    expect(libelleAppareil(ua)).toBe(attendu);
  });
});

async function compteAvecDeuxSessions() {
  const db = await baseLocale();
  const compte = (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [`app-${randomUUID().slice(0, 8)}@exemple.test`])).rows[0].id;
  const ici = `ici-${randomUUID()}`;
  const ailleurs = `ailleurs-${randomUUID()}`;
  for (const h of [ailleurs, ici]) {
    await db.query("insert into sessions_compte (compte_id, jeton_hache, expire_le) values ($1, $2, now() + interval '30 days')", [compte, h]);
  }
  await fonctionSql("noter_appareil", { p_session_hache: ici, p_appareil: "Safari sur iPhone" });
  await fonctionSql("noter_appareil", { p_session_hache: ailleurs, p_appareil: "Chrome sur Mac" });
  return { compte, ici, ailleurs };
}

type Appareil = { id: string; appareil: string | null; cree_le: string; courant: boolean };

describe("appareils connectés", () => {
  it("liste les sessions ouvertes, celle-ci marquée", async () => {
    const c = await compteAvecDeuxSessions();
    const liste = await fonctionSql<Appareil[]>("appareils_compte", { p_compte: c.compte, p_session_hache: c.ici });
    expect(liste.map((a) => [a.appareil, a.courant]).sort()).toEqual([["Chrome sur Mac", false], ["Safari sur iPhone", true]]);
  });

  it("déconnecte un seul appareil ; jamais celui d'un autre compte", async () => {
    const a = await compteAvecDeuxSessions();
    const b = await compteAvecDeuxSessions();
    const listeA = await fonctionSql<Appareil[]>("appareils_compte", { p_compte: a.compte, p_session_hache: a.ici });
    const autre = listeA.find((x) => !x.courant)!;
    const listeB = await fonctionSql<Appareil[]>("appareils_compte", { p_compte: b.compte, p_session_hache: b.ici });
    expect(await fonctionSql<boolean>("deconnecter_appareil", { p_compte: a.compte, p_session: listeB[0].id, p_ip_court: "10.1" })).toBe(false);
    expect(await fonctionSql<boolean>("deconnecter_appareil", { p_compte: a.compte, p_session: autre.id, p_ip_court: "10.1" })).toBe(true);
    const apres = await fonctionSql<Appareil[]>("appareils_compte", { p_compte: a.compte, p_session_hache: a.ici });
    expect(apres.map((x) => x.appareil)).toEqual(["Safari sur iPhone"]);
    expect(await fonctionSql<Appareil[]>("appareils_compte", { p_compte: b.compte, p_session_hache: b.ici })).toHaveLength(2);
  });

  it("le nom d'un appareil ne se réécrit pas après coup", async () => {
    const c = await compteAvecDeuxSessions();
    await fonctionSql("noter_appareil", { p_session_hache: c.ici, p_appareil: "Autre chose" });
    const liste = await fonctionSql<Appareil[]>("appareils_compte", { p_compte: c.compte, p_session_hache: c.ici });
    expect(liste.find((a) => a.courant)!.appareil).toBe("Safari sur iPhone");
  });
});
