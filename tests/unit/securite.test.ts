import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Correctifs de l'audit de sécurité (docs/audits/securite.md). Chaque test reprend une faille constatée.
// Les variables d'environnement sont lues à l'exécution : on les pose et on les remet à chaque test.

const VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "BASE_DE_TEST",
  "CONTEXTE_DEPLOIEMENT",
  "STRIPE_SECRET_KEY",
  "RESEND_API_KEY",
  "COURRIEL_EXPEDITEUR",
  "SECRET_COMPTES",
  "AWS_LAMBDA_FUNCTION_NAME",
] as const;
let sauvegarde: Record<string, string | undefined> = {};
beforeEach(() => {
  sauvegarde = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  for (const v of VARIABLES) delete process.env[v];
  process.env.CONTEXTE_DEPLOIEMENT = "deploy-preview";
});
afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

// Préversion branchée sur le vrai projet Supabase (situation du 12.11.2026).
function vraieBase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projet-inexistant.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_factice";
}

describe("S1 : aucun code de connexion à l'écran sur une vraie base", () => {
  it("la base embarquée et un projet déclaré de test sont des bases de test, le vrai projet non", async () => {
    const { baseDeTest } = await import("@/lib/environnement");
    expect(baseDeTest()).toBe(true);
    vraieBase();
    expect(baseDeTest()).toBe(false);
    process.env.BASE_DE_TEST = "1";
    expect(baseDeTest()).toBe(true);
  });

  it("refuse d'envoyer un code au personnel sans e-mail, même pour une adresse en .test", async () => {
    vraieBase();
    const { demanderCodePersonnel } = await import("@/lib/personnel/connexion");
    const r = await demanderCodePersonnel("equipe@laferme.test", "203.0.113.1");
    expect(r).toEqual({ statut: "envoi-indisponible" });
  });

  it("refuse d'envoyer un code à un client sans e-mail, même pour une adresse en .test", async () => {
    vraieBase();
    const { demanderCode } = await import("@/lib/comptes/connexion");
    const r = await demanderCode("client@exemple.test", "203.0.113.1");
    expect(r).toEqual({ statut: "envoi-indisponible" });
  });
});

describe("S2 : pas de paiement simulé sur une vraie base", () => {
  it("refuse la doublure de paiement quand le serveur écrit dans le vrai projet", async () => {
    vraieBase();
    const { paiementDisponible, passerelle } = await import("@/lib/paiement/passerelle");
    expect(() => passerelle()).toThrow(/vraie base/);
    expect(paiementDisponible()).toBe(false);
  });

  it("refuse une clé Stripe de test quand le serveur écrit dans le vrai projet", async () => {
    vraieBase();
    process.env.STRIPE_SECRET_KEY = "sk_test_factice";
    const { clientStripe } = await import("@/lib/paiement/passerelle");
    expect(() => clientStripe()).toThrow(/vraie base/);
  });

  it("garde la doublure pour la base embarquée et pour un projet déclaré de test", async () => {
    const { passerelle } = await import("@/lib/paiement/passerelle");
    expect(passerelle().nom).toBe("doublure");
    vraieBase();
    process.env.BASE_DE_TEST = "1";
    expect(passerelle().nom).toBe("doublure");
  });
});

describe("S4 : une adresse IPv6 compte pour tout son /64", () => {
  it("regroupe deux adresses du même abonné", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    const { ipDe } = await import("@/lib/comptes/securite");
    const req = (ip: string) => new Request("https://exemple.ch", { headers: { "x-nf-client-connection-ip": ip } });
    expect(ipDe(req("2001:db8:1:2:aaaa:bbbb:cccc:1"))).toBe(ipDe(req("2001:db8:1:2::ff")));
    expect(ipDe(req("2001:db8:1:3::1"))).not.toBe(ipDe(req("2001:db8:1:2::1")));
    expect(ipDe(req("203.0.113.7"))).toBe("203.0.113.7");
  });
});

describe("S6 : clé propre à la production pour les empreintes", () => {
  it("refuse en production de tirer la clé des empreintes de la clé Supabase", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_factice";
    const { empreinte } = await import("@/lib/comptes/securite");
    expect(() => empreinte("session", "x")).toThrow(/SECRET_COMPTES/);
    process.env.SECRET_COMPTES = "une-cle-propre-a-la-production";
    expect(empreinte("session", "x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("S7 : un build du poste ne tourne pas sur Netlify", () => {
  it("refuse le contexte « local » dans une fonction en ligne", async () => {
    process.env.CONTEXTE_DEPLOIEMENT = "local";
    const { verifierContexte } = await import("@/lib/environnement");
    expect(() => verifierContexte()).not.toThrow();
    process.env.AWS_LAMBDA_FUNCTION_NAME = "___netlify-server-handler";
    expect(() => verifierContexte()).toThrow(/Netlify/);
  });
});
