import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, client-compte : quota d'envoi de la boîte Infomaniak (500 e-mails par 24 heures). Les types les
// moins utiles s'arrêtent d'abord, un envoi refusé est noté dans l'historique de la commande sans la bloquer,
// et le restaurant est prévenu une fois à 80 %. Le transport SMTP est remplacé : rien ne part sur le réseau.
const smtp = { messages: [] as { to: unknown; subject: string }[], panne: false };
vi.mock("nodemailer", () => ({
  default: {
    createTransport() {
      return {
        close() {},
        async sendMail(message: { to: unknown; subject: string }) {
          if (smtp.panne) throw Object.assign(new Error("550 refusé (simulé)"), { responseCode: 550 });
          smtp.messages.push(message);
          return { messageId: "<test@exemple.test>" };
        },
      };
    },
  },
}));

const VARIABLES = ["SMTP_UTILISATEUR", "SMTP_MOT_DE_PASSE", "COURRIEL_EXPEDITEUR", "COURRIELS_PLAFOND_JOUR", "ALERTE_EMAIL", "CONTEXTE_DEPLOIEMENT"] as const;
let sauvegarde: Record<string, string | undefined> = {};
beforeEach(() => {
  sauvegarde = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  process.env.SMTP_UTILISATEUR = "commande@exemple.test";
  process.env.SMTP_MOT_DE_PASSE = "mot-de-passe-factice";
  process.env.COURRIEL_EXPEDITEUR = "La Ferme <commande@exemple.test>";
  process.env.ALERTE_EMAIL = "alertes@exemple.test";
  process.env.CONTEXTE_DEPLOIEMENT = "local";
  smtp.messages = [];
  smtp.panne = false;
});
afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

// Plafond posé au-dessus de ce que les autres tests ont déjà envoyé : places libres = « libres ».
async function plafondAvecLibres(libres: number): Promise<number> {
  const db = await baseLocale();
  const n = (await db.query<{ n: number }>("select count(*)::int n from envois_courriel where statut in ('reserve', 'envoye') and cree_le > now() - interval '24 hours'")).rows[0].n;
  process.env.COURRIELS_PLAFOND_JOUR = String(n + libres);
  return n + libres;
}

// L'alerte de quota part en différé : le module chargé d'avance, elle part tout de suite.
beforeAll(async () => {
  await import("@/lib/surveillance");
});

let k = 0;
async function commande(): Promise<string> {
  const db = await baseLocale();
  const cle = `quota-${++k}-${Date.now()}`;
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-${cle}`,
      cle_idempotence: cle,
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir",
      client_prenom: "Test",
      client_nom: "Quota",
      client_telephone: `079 555 33 ${String(k).padStart(2, "0")}`,
      client_email: `quota${k}@exemple.test`,
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: 2000,
      frais_centimes: 0,
      total_centimes: 2000,
      tva_centimes: 51,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 2000, total_centimes: 2000, choix: {}, retraits: [], note: "" }],
    },
  ]);
  return r.rows[0].id;
}

const envoi = () => import("@/lib/courriel/envoi");
const quota = () => import("@/lib/courriel/quota");

function message(type: import("@/lib/courriel/quota").TypeCourriel, commandeId: string, n: number) {
  return { commandeId, destinataire: `client${n}@exemple.test`, sujet: `Sujet ${type} ${n}`, texte: `Texte ${n}`, html: `<p>${n}</p>`, type };
}

describe("quota d'envoi", () => {
  it("les priorités basses s'arrêtent d'abord, les codes partent jusqu'au bout", async () => {
    const { envoyerCourriel, envoyerCodeParCourriel } = await envoi();
    const plafond = await plafondAvecLibres(20);
    const c = await commande();
    // 17 envois de suivi : on arrive à 85 % du plafond au moins (dépend de la base, d'où le calcul).
    const deja = plafond - 20;
    const jusqua85 = Math.floor(plafond * 0.85) - deja;
    for (let i = 0; i < jusqua85; i++) await envoyerCourriel(message("acceptation", c, i));
    await expect(envoyerCourriel(message("prete", c, 900))).rejects.toThrow(/limite d'envoi du jour atteinte/);
    // Le suivi (95 %) passe encore, le code passe jusqu'au plafond.
    await envoyerCourriel(message("nouvelle_heure", c, 901));
    while ((await (await quota()).etatQuotaCourriels()).restants > 0) {
      await envoyerCodeParCourriel({ destinataire: "code@exemple.test", sujet: `Code ${Math.random()}`, texte: "x", html: "x" });
    }
    await expect(envoyerCodeParCourriel({ destinataire: "code@exemple.test", sujet: "Code fin", texte: "x", html: "x" })).rejects.toThrow(/limite/);
    expect(smtp.messages.some((m) => m.subject === "Sujet prete 900")).toBe(false);
  });

  it("un envoi refusé est noté dans l'historique de la commande, sans données du client", async () => {
    const { envoyerCourriel } = await envoi();
    await plafondAvecLibres(0);
    const c = await commande();
    await expect(envoyerCourriel(message("prete", c, 1))).rejects.toThrow();
    const db = await baseLocale();
    const ev = (await db.query<{ vers: string; detail: string; par: string }>("select vers, detail, par from evenements_commande where commande_id = $1", [c])).rows;
    expect(ev).toEqual([{ vers: "courriel_non_envoye", detail: "prete", par: "site" }]);
    // Le journal ne garde ni adresse ni sujet.
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'envois_courriel'")).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["commande_id", "cree_le", "id", "priorite", "statut", "type"]);
  });

  it("le restaurant est prévenu une seule fois en franchissant 80 %", async () => {
    const { envoyerCourriel } = await envoi();
    const plafond = await plafondAvecLibres(10);
    // Une alerte en route d'un test précédent arrive d'abord ; on repart d'une boîte vide.
    await new Promise((r) => setTimeout(r, 300));
    smtp.messages = [];
    const db = await baseLocale();
    // Une alerte de quota déjà partie dans les 24 heures (autre test) empêcherait la suivante : on repart propre.
    await db.query("update envois_courriel set cree_le = cree_le - interval '2 days' where type = 'alerte_quota'");
    const c = await commande();
    const avant80 = Math.ceil(plafond * 0.8) - (plafond - 10);
    for (let i = 0; i < avant80 + 2; i++) await envoyerCourriel(message("confirmation", c, 100 + i));
    // L'alerte part en différé (import de la surveillance) : on l'attend, puis on vérifie qu'elle est seule.
    await vi.waitFor(() => expect(smtp.messages.filter((m) => /80 %/.test(m.subject))).toHaveLength(1), { timeout: 5000 });
    for (let i = 0; i < 2; i++) await envoyerCourriel(message("confirmation", c, 200 + i));
    await new Promise((r) => setTimeout(r, 200));
    const alertes = smtp.messages.filter((m) => /80 %/.test(m.subject));
    expect(alertes).toHaveLength(1);
    expect(alertes[0].to).toMatchObject({ address: "alertes@exemple.test" });
  });

  it("un refus du serveur SMTP rend la place", async () => {
    const { envoyerCourriel } = await envoi();
    const { etatQuotaCourriels } = await quota();
    await plafondAvecLibres(5);
    const c = await commande();
    const avant = (await etatQuotaCourriels()).envoyes;
    smtp.panne = true;
    await expect(envoyerCourriel(message("acceptation", c, 500))).rejects.toThrow(/550/);
    expect((await etatQuotaCourriels()).envoyes).toBe(avant);
  });

  it("état du jour pour le back-office", async () => {
    const { etatQuotaCourriels } = await quota();
    const plafond = await plafondAvecLibres(7);
    const e = await etatQuotaCourriels();
    expect(e).toMatchObject({ plafond, restants: 7 });
    expect(e.envoyes).toBe(plafond - 7);
  });

  it("plafond réglable, 500 par défaut", async () => {
    const { plafondJour } = await quota();
    delete process.env.COURRIELS_PLAFOND_JOUR;
    expect(plafondJour()).toBe(500);
    process.env.COURRIELS_PLAFOND_JOUR = "2000";
    expect(plafondJour()).toBe(2000);
    process.env.COURRIELS_PLAFOND_JOUR = "abc";
    expect(plafondJour()).toBe(500);
  });
});

describe("variante « moins d'e-mails » (désactivée par défaut)", () => {
  it("COURRIELS_REDUITS=1 : « prête » et « en route » ne partent plus, « acceptée » oui", async () => {
    const { envoyerCourriel } = await envoi();
    await plafondAvecLibres(50);
    const c = await commande();
    await envoyerCourriel(message("prete", c, 700));
    expect(smtp.messages.map((m) => m.subject)).toContain("Sujet prete 700");
    process.env.COURRIELS_REDUITS = "1";
    try {
      await envoyerCourriel(message("prete", c, 701));
      await envoyerCourriel(message("en_route", c, 702));
      await envoyerCourriel(message("acceptation", c, 703));
    } finally {
      delete process.env.COURRIELS_REDUITS;
    }
    const sujets = smtp.messages.map((m) => m.subject);
    expect(sujets).not.toContain("Sujet prete 701");
    expect(sujets).not.toContain("Sujet en_route 702");
    expect(sujets).toContain("Sujet acceptation 703");
  });
});

describe("chaque modèle dit son type", () => {
  it("prête et en route selon le mode, code, confirmation", async () => {
    const m = await import("@/lib/courriel/modeles");
    const c = { numero: 1, client_prenom: "A", mode: "livraison", origine: "http://x", jeton_suivi: "j", statut_paiement: "paye", total_centimes: 100 } as never;
    expect(m.courrielPrete(c).type).toBe("en_route");
    expect(m.courrielPrete({ ...(c as object), mode: "retrait" } as never).type).toBe("prete");
    expect(m.courrielCode("123456").type).toBe("code");
    expect(m.courrielAcceptation(c, "2026-11-13T18:00:00Z").type).toBe("acceptation");
  });
});
