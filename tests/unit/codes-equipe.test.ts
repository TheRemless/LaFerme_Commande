import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { baseLocale } from "@/lib/db/locale";
import { empreinte } from "@/lib/comptes/securite";
import { demanderCodePersonnel, verifierCodePersonnel } from "@/lib/personnel/connexion";

// Codes de connexion de l'équipe (vague 3, bo-socle, revue de sécurité de client-compte) :
// 1. plafond global sur 24 heures, construit désactivé (la valeur est une décision de Jérémy) ;
// 2. l'alerte de blocage part au restaurant même quand la limite d'envoi du jour refuse le courriel au membre.

const smtp = vi.hoisted(() => ({ refuserBlocage: false }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ close() {}, async sendMail() { return { messageId: "<test@exemple.test>" }; } }) },
}));
// La limite d'envoi refuse seulement le courriel de blocage : l'alerte au restaurant, plus prioritaire, passe.
vi.mock("@/lib/courriel/quota", async (original) => {
  const vrai = await original<typeof import("@/lib/courriel/quota")>();
  return {
    ...vrai,
    reserverEnvoi: async (type: Parameters<typeof vrai.reserverEnvoi>[0], commande: string | null) => {
      if (smtp.refuserBlocage && type === "blocage") throw new vrai.QuotaAtteint(type);
      return vrai.reserverEnvoi(type, commande);
    },
  };
});

let db: PGlite;
let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");
const demander = async (email: string) => (await db.query<{ r: number }>("select demander_code_personnel($1, $2, $3, $4, 'ip') as r", [email, h(), h(), h()])).rows[0].r;
const PLAFOND = "plafond_codes_personnel_jour";
const EQUIPE = ["gerant-bureau@laferme.test", "gerant-mobile@laferme.test", "cuisine-bureau@laferme.test", "cuisine-mobile@laferme.test"];

beforeAll(async () => {
  db = await baseLocale();
});
beforeEach(async () => {
  await db.query("delete from tentatives_connexion where action in ('envoi_email', 'envoi_ip', 'envoi_global')");
  await db.query("delete from reglages where cle = $1", [PLAFOND]);
});

describe("plafond global des codes de l'équipe", () => {
  it("construit désactivé : sans réglage, aucun plafond", async () => {
    expect((await db.query<{ p: number | null }>("select plafond_codes_personnel() as p")).rows[0].p).toBeNull();
    for (const e of EQUIPE) expect(await demander(e)).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from tentatives_connexion where action = 'envoi_global'")).rows[0].n).toBe(0);
  });

  it("activé : au plafond, plus de code, le restaurant est prévenu une fois, une adresse inconnue ne compte pas", async () => {
    await db.query("insert into reglages (cle, valeur, proposition) values ($1, '2', false)", [PLAFOND]);
    expect(await demander("inconnu@exemple.test")).toBe(-1);
    expect(await demander(EQUIPE[0])).toBe(0);
    expect(await demander(EQUIPE[1])).toBe(0);
    expect(await demander(EQUIPE[2])).toBe(-3);
    expect(await demander(EQUIPE[3])).toBe(-2);
    // Aucun code créé au plafond.
    const codes = await db.query<{ n: number }>("select count(*)::int as n from codes_connexion where cle_email = $1 and cree_le > now() - interval '1 minute'", [h()]);
    expect(codes.rows[0].n).toBe(0);
  });

  it("un réglage illisible ou inférieur à 1 laisse le plafond désactivé", async () => {
    await db.query("insert into reglages (cle, valeur, proposition) values ($1, '\"beaucoup\"', false)", [PLAFOND]);
    expect((await db.query<{ p: number | null }>("select plafond_codes_personnel() as p")).rows[0].p).toBeNull();
    await db.query("update reglages set valeur = '0' where cle = $1", [PLAFOND]);
    expect((await db.query<{ p: number | null }>("select plafond_codes_personnel() as p")).rows[0].p).toBeNull();
  });

  it("au plafond, la réponse du site est la même qu'une adresse inconnue", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "local";
    await db.query("insert into reglages (cle, valeur, proposition) values ($1, '1', false)", [PLAFOND]);
    expect(await demander(EQUIPE[0])).toBe(0);
    const r = await demanderCodePersonnel(EQUIPE[1], "203.0.113.40");
    expect(r).toEqual({ statut: "envoye" });
  });
});

describe("alerte de blocage malgré la limite d'envoi du jour", () => {
  it("le membre ne reçoit rien, mais le restaurant est prévenu et sait que le membre n'a rien reçu", async () => {
    process.env.SMTP_UTILISATEUR = "test";
    process.env.SMTP_MOT_DE_PASSE = "test";
    process.env.COURRIEL_EXPEDITEUR = "site@exemple.test";
    process.env.CONTEXTE_DEPLOIEMENT = "local";
    smtp.refuserBlocage = true;
    try {
      const email = EQUIPE[2];
      const cle = empreinte("email-personnel", email);
      await db.query("delete from tentatives_connexion where action = 'echec_email' and cle = $1", [cle]);
      for (let i = 0; i < 14; i++) await db.query("insert into tentatives_connexion (action, cle) values ('echec_email', $1)", [cle]);
      const avant = (await db.query<{ t: string }>("select clock_timestamp()::text as t")).rows[0].t;
      expect((await verifierCodePersonnel(email, "00000000", "203.0.113.41", null)).statut).toBe("invalide");
      const apres = await db.query<{ destinataire: string; texte: string }>("select destinataire, texte from courriels where envoye_le >= $1::timestamptz", [avant]);
      expect(apres.rows.map((c) => c.destinataire)).not.toContain(email);
      const alerte = apres.rows.find((c) => /bloquée 24 heures/.test(c.texte) || /15 codes faux/.test(c.texte));
      expect(alerte?.texte).toMatch(/n'a pas reçu d'e-mail/);
      await db.query("delete from tentatives_connexion where action = 'echec_email' and cle = $1", [cle]);
    } finally {
      smtp.refuserBlocage = false;
      delete process.env.SMTP_UTILISATEUR;
      delete process.env.SMTP_MOT_DE_PASSE;
      delete process.env.COURRIEL_EXPEDITEUR;
    }
  });
});
