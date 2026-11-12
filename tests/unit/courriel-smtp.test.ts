import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Envoi des courriels par le serveur SMTP du restaurant (Infomaniak), à la place de Resend
// (décision de Jérémy du 12.11.2026). Le transport est remplacé : rien ne part sur le réseau.
const smtp = { transports: [] as Record<string, unknown>[], messages: [] as Record<string, unknown>[], panne: false };
vi.mock("nodemailer", () => ({
  default: {
    createTransport(options: Record<string, unknown>) {
      smtp.transports.push(options);
      return {
        async sendMail(message: Record<string, unknown>) {
          if (smtp.panne) throw Object.assign(new Error("535 5.7.8 Authentification refusée pour client@exemple.test (simulé)"), { responseCode: 535 });
          smtp.messages.push(message);
          return { messageId: "<test@exemple.test>" };
        },
      };
    },
  },
}));

const VARIABLES = ["SMTP_HOTE", "SMTP_PORT", "SMTP_UTILISATEUR", "SMTP_MOT_DE_PASSE", "COURRIEL_EXPEDITEUR", "CONTEXTE_DEPLOIEMENT"] as const;
let sauvegarde: Record<string, string | undefined> = {};
beforeEach(() => {
  sauvegarde = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  for (const v of VARIABLES) delete process.env[v];
  smtp.transports = [];
  smtp.messages = [];
  smtp.panne = false;
});
afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

function brancherSmtp() {
  process.env.SMTP_UTILISATEUR = "commande@exemple.test";
  process.env.SMTP_MOT_DE_PASSE = "mot-de-passe-factice";
  process.env.COURRIEL_EXPEDITEUR = "La Ferme <commande@exemple.test>";
}

let k = 0;
async function commande(): Promise<string> {
  const db = await baseLocale();
  const cle = `smtp-${++k}-${Date.now()}`;
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-${cle}`,
      cle_idempotence: cle,
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir",
      client_prenom: "Test",
      client_nom: "Smtp",
      client_telephone: `079 555 44 ${String(k).padStart(2, "0")}`,
      client_email: `smtp${k}@exemple.test`,
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: 100,
      frais_centimes: 0,
      total_centimes: 100,
      tva_centimes: 0,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 100, total_centimes: 100, choix: {}, retraits: [], note: "" }],
    },
  ]);
  return r.rows[0].id;
}

async function copies(id: string) {
  const db = await baseLocale();
  return (await db.query<{ sujet: string; texte: string; fournisseur: string }>("select sujet, texte, fournisseur from courriels where commande_id = $1 order by envoye_le", [id])).rows;
}

describe("réglages du serveur d'envoi", () => {
  it("n'est branché qu'avec l'identifiant, le mot de passe et l'expéditeur", async () => {
    const { courrielConfigure } = await import("@/lib/courriel/envoi");
    expect(courrielConfigure()).toBe(false);
    brancherSmtp();
    expect(courrielConfigure()).toBe(true);
    delete process.env.SMTP_MOT_DE_PASSE;
    expect(courrielConfigure()).toBe(false);
  });

  it("vise Infomaniak sur le port 587 avec STARTTLS exigé, sauf réglage contraire", async () => {
    brancherSmtp();
    const { envoyerCodeParCourriel } = await import("@/lib/courriel/envoi");
    expect(await envoyerCodeParCourriel({ destinataire: "client@exemple.test", sujet: "Votre code", texte: "123456", html: "<p>123456</p>" })).toBe(true);
    expect(smtp.transports[0]).toMatchObject({
      host: "mail.infomaniak.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "commande@exemple.test", pass: "mot-de-passe-factice" },
    });
    expect(smtp.messages[0]).toMatchObject({
      from: "La Ferme <commande@exemple.test>",
      to: "client@exemple.test",
      subject: "Votre code",
      text: "123456",
      html: "<p>123456</p>",
    });
  });

  it("chiffre dès la connexion sur le port 465", async () => {
    brancherSmtp();
    process.env.SMTP_PORT = "465";
    process.env.SMTP_HOTE = "smtp.exemple.test";
    const { envoyerCodeParCourriel } = await import("@/lib/courriel/envoi");
    await envoyerCodeParCourriel({ destinataire: "client@exemple.test", sujet: "s", texte: "t", html: "h" });
    expect(smtp.transports[0]).toMatchObject({ host: "smtp.exemple.test", port: 465, secure: true });
  });

  it("refuse un port qui n'est pas un port d'envoi chiffré", async () => {
    brancherSmtp();
    process.env.SMTP_PORT = "25";
    const { envoyerCodeParCourriel } = await import("@/lib/courriel/envoi");
    await expect(envoyerCodeParCourriel({ destinataire: "client@exemple.test", sujet: "s", texte: "t", html: "h" })).rejects.toThrow(/SMTP_PORT/);
    expect(smtp.messages).toHaveLength(0);
  });
});

describe("sans serveur d'envoi", () => {
  it("hors production, le code n'est pas envoyé et l'appelant le sait", async () => {
    const { envoyerCodeParCourriel } = await import("@/lib/courriel/envoi");
    expect(await envoyerCodeParCourriel({ destinataire: "client@exemple.test", sujet: "s", texte: "t", html: "h" })).toBe(false);
    expect(smtp.transports).toHaveLength(0);
  });

  it("en production, l'envoi échoue au lieu de se taire", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    const { envoyerCodeParCourriel, envoyerCourriel } = await import("@/lib/courriel/envoi");
    await expect(envoyerCodeParCourriel({ destinataire: "client@exemple.test", sujet: "s", texte: "t", html: "h" })).rejects.toThrow(/SMTP_UTILISATEUR/);
    await expect(envoyerCourriel({ commandeId: await commande(), destinataire: "client@exemple.test", sujet: "s", texte: "t", html: "h" })).rejects.toThrow(/SMTP_UTILISATEUR/);
  });

  it("hors production, le courriel d'une commande est gardé en copie par la doublure", async () => {
    const { envoyerCourriel } = await import("@/lib/courriel/envoi");
    const id = await commande();
    await envoyerCourriel({ commandeId: id, destinataire: "client@exemple.test", sujet: "Commande reçue", texte: "Merci", html: "<p>Merci</p>" });
    expect(await copies(id)).toEqual([{ sujet: "Commande reçue", texte: "Merci", fournisseur: "doublure" }]);
  });
});

describe("courriels d'une commande par SMTP", () => {
  it("part, puis garde une copie marquée smtp", async () => {
    brancherSmtp();
    const { envoyerCourriel } = await import("@/lib/courriel/envoi");
    const id = await commande();
    await envoyerCourriel({ commandeId: id, destinataire: "client@exemple.test", sujet: "Commande reçue", texte: "Merci", html: "<p>Merci</p>" });
    expect(smtp.messages).toHaveLength(1);
    expect(await copies(id)).toEqual([{ sujet: "Commande reçue", texte: "Merci", fournisseur: "smtp" }]);
  });

  it("le même courriel rejoué ne part qu'une fois, un contenu différent part aussi (SS-15)", async () => {
    brancherSmtp();
    const { envoyerCourriel } = await import("@/lib/courriel/envoi");
    const id = await commande();
    const base = { commandeId: id, destinataire: "client@exemple.test", sujet: "Commande 4, nouvelle heure", html: "" };
    await envoyerCourriel({ ...base, texte: "vers 19h45" });
    await envoyerCourriel({ ...base, texte: "vers 19h45" });
    expect(smtp.messages).toHaveLength(1);
    await envoyerCourriel({ ...base, texte: "vers 20h00" });
    expect(smtp.messages).toHaveLength(2);
    expect((await copies(id)).map((c) => c.texte)).toEqual(["vers 19h45", "vers 20h00"]);
  });

  it("le même contenu pour un autre destinataire part aussi", async () => {
    brancherSmtp();
    const { envoyerCourriel } = await import("@/lib/courriel/envoi");
    const id = await commande();
    const base = { commandeId: id, sujet: "Commande reçue", texte: "Merci", html: "" };
    await envoyerCourriel({ ...base, destinataire: "a@exemple.test" });
    await envoyerCourriel({ ...base, destinataire: "b@exemple.test" });
    expect(smtp.messages).toHaveLength(2);
  });

  it("une panne du serveur d'envoi remonte et ne laisse pas de copie : le courriel pourra repartir", async () => {
    brancherSmtp();
    const { envoyerCourriel } = await import("@/lib/courriel/envoi");
    const id = await commande();
    const c = { commandeId: id, destinataire: "client@exemple.test", sujet: "Commande reçue", texte: "Merci", html: "" };
    smtp.panne = true;
    const erreur = await envoyerCourriel(c).then(() => null, (e: Error) => e.message);
    expect(erreur).toMatch(/535/);
    // Le message du serveur peut citer l'adresse du client : elle ne part pas dans les journaux.
    expect(erreur).not.toMatch(/@/);
    expect(await copies(id)).toHaveLength(0);
    smtp.panne = false;
    await envoyerCourriel(c);
    expect(smtp.messages).toHaveLength(1);
  });
});
