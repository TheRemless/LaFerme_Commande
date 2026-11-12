import { beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { codeValide, empreinte } from "@/lib/comptes/securite";
import { DUREE_MIN_DEMANDE_MS, demanderCodePersonnel, verifierCodePersonnel } from "@/lib/personnel/connexion";

// Suite de l'audit de sécurité (docs/audits/securite.md) pour la connexion du personnel, sur la base embarquée :
// S11 (même durée de réponse, adresse de l'équipe ou non), S4 (code à 8 chiffres, alerte quand une adresse
// de l'équipe est bloquée par des codes faux).

const EQUIPE = "equipe@laferme.test";
const IP = "203.0.113.9";

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERTE_EMAIL;
  process.env.CONTEXTE_DEPLOIEMENT = "local";
});

async function ouvrirEnvois() {
  const db = await baseLocale();
  await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip')");
}

describe("S11 : la demande de code ne trahit pas les adresses de l'équipe par sa durée", () => {
  it("une adresse inconnue répond après la même durée minimale qu'une adresse de l'équipe", async () => {
    expect(DUREE_MIN_DEMANDE_MS).toBeGreaterThanOrEqual(1000);
    for (const email of ["personne@exemple.test", EQUIPE]) {
      await ouvrirEnvois();
      const debut = performance.now();
      const r = await demanderCodePersonnel(email, IP);
      expect(r.statut).toBe("envoye");
      expect(performance.now() - debut).toBeGreaterThanOrEqual(DUREE_MIN_DEMANDE_MS - 5);
    }
  });
});

describe("S4 : code à 8 chiffres pour le personnel", () => {
  it("le code du personnel a 8 chiffres, celui des clients en garde 6", async () => {
    await ouvrirEnvois();
    const r = await demanderCodePersonnel(EQUIPE, IP);
    expect(r.statut === "envoye" && r.codePreversion).toMatch(/^\d{8}$/);
    expect(codeValide("12345678", 8)).toBe("12345678");
    expect(codeValide("123456", 8)).toBeNull();
    expect(codeValide("123456")).toBe("123456");
    expect(codeValide("12345678")).toBeNull();
  });

  it("le bon code à 8 chiffres ouvre la session", async () => {
    await ouvrirEnvois();
    const r = await demanderCodePersonnel(EQUIPE, "203.0.113.10");
    const code = r.statut === "envoye" ? r.codePreversion! : "";
    expect((await verifierCodePersonnel(EQUIPE, code, "203.0.113.10", null)).statut).toBe("ok");
  });
});

describe("S4 : alerte quand une adresse de l'équipe est bloquée par des codes faux", () => {
  async function courrielsBlocage(): Promise<{ destinataire: string; sujet: string; texte: string }[]> {
    const db = await baseLocale();
    return (await db.query<{ destinataire: string; sujet: string; texte: string }>("select destinataire, sujet, texte from courriels where sujet like '%bloqu%' order by envoye_le")).rows;
  }

  async function essaiFaux(email: string) {
    const db = await baseLocale();
    await ouvrirEnvois();
    await demanderCodePersonnel(email, "203.0.113.11");
    await db.query("update codes_connexion set prochain_essai_le = now()");
    return verifierCodePersonnel(email, "00000000", "203.0.113.11", null);
  }

  it("le 15e code faux bloque l'adresse et prévient le membre et le restaurant, une seule fois", async () => {
    const db = await baseLocale();
    const cle = empreinte("email-personnel", EQUIPE);
    await db.query("delete from tentatives_connexion where action = 'echec_email' and cle = $1", [cle]);
    for (let i = 0; i < 14; i++) await db.query("insert into tentatives_connexion (action, cle) values ('echec_email', $1)", [cle]);
    const avant = (await courrielsBlocage()).length;

    expect((await essaiFaux(EQUIPE)).statut).toBe("invalide");
    const alertes = (await courrielsBlocage()).slice(avant);
    expect(alertes.map((c) => c.destinataire).sort()).toEqual([EQUIPE, "restaurant"].sort());
    expect(alertes.find((c) => c.destinataire === EQUIPE)?.texte).toMatch(/15 codes faux/);

    // Les essais suivants attendent, sans nouvelle alerte.
    expect((await verifierCodePersonnel(EQUIPE, "00000000", "203.0.113.11", null)).statut).toBe("attente");
    expect((await courrielsBlocage()).length).toBe(avant + 2);
    await db.query("delete from tentatives_connexion where action = 'echec_email' and cle = $1", [cle]);
  });

  it("une adresse hors de l'équipe bloquée ne déclenche aucun courriel", async () => {
    const db = await baseLocale();
    const email = "intrus@exemple.test";
    const cle = empreinte("email-personnel", email);
    for (let i = 0; i < 14; i++) await db.query("insert into tentatives_connexion (action, cle) values ('echec_email', $1)", [cle]);
    const avant = (await courrielsBlocage()).length;
    expect((await essaiFaux(email)).statut).toBe("invalide");
    expect((await courrielsBlocage()).length).toBe(avant);
  });
});

describe("S11 : même plancher quand l'envoi échoue", () => {
  it("une erreur d'envoi pour une adresse de l'équipe ne répond pas plus vite", async () => {
    const avant = { cle: process.env.RESEND_API_KEY, exp: process.env.COURRIEL_EXPEDITEUR, f: globalThis.fetch };
    process.env.RESEND_API_KEY = "re_factice";
    process.env.COURRIEL_EXPEDITEUR = "La Ferme <test@exemple.test>";
    globalThis.fetch = (async () => new Response("panne", { status: 500 })) as typeof fetch;
    try {
      await ouvrirEnvois();
      const debut = performance.now();
      await expect(demanderCodePersonnel(EQUIPE, IP)).rejects.toThrow();
      expect(performance.now() - debut).toBeGreaterThanOrEqual(DUREE_MIN_DEMANDE_MS - 5);
    } finally {
      globalThis.fetch = avant.f;
      if (avant.cle === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = avant.cle;
      if (avant.exp === undefined) delete process.env.COURRIEL_EXPEDITEUR; else process.env.COURRIEL_EXPEDITEUR = avant.exp;
    }
  });
});
