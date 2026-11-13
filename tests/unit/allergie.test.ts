import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { allergieValide } from "@/lib/validation";

// Vague 3, client-commande : allergie ou intolérance pour toute la commande, séparée de la note libre.
// Une donnée de santé (nLPD art. 5) : gardée sur la commande pour la cuisine, jamais copiée dans le compte.

// Client invité : aucun cookie de session.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
process.env.SANS_LIMITE_COMPTOIR = "1";
let POST: (r: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/commandes/route"));
});

function commander(corps: Record<string, unknown>) {
  return POST(
    new Request("http://localhost:3000/api/commandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cle: randomUUID(),
        lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
        mode: "retrait",
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        client: { prenom: "Test", nom: "Allergie", telephone: "079 000 00 00", email: `allergie-${randomUUID().slice(0, 8)}@laferme.test` },
        moyen: "comptoir",
        ...corps,
      }),
    }),
  );
}

async function allergieDe(redirection: string): Promise<string> {
  const jeton = redirection.split("/suivi/")[1];
  const db = await baseLocale();
  return (await db.query<{ allergie: string }>("select allergie from commandes where jeton_suivi = $1", [jeton])).rows[0].allergie;
}

describe("allergieValide", () => {
  it("garde le texte, sans espaces en trop ni caractères de contrôle", () => {
    expect(allergieValide("  arachides,\n  fruits à coque  ")).toBe("arachides, fruits à coque");
    expect(allergieValide("gluten\u0007")).toBe("gluten");
  });
  it("absente ou vide : chaîne vide", () => {
    expect(allergieValide(undefined)).toBe("");
    expect(allergieValide("   ")).toBe("");
  });
  it("refuse un texte trop long ou d'un autre type", () => {
    expect(allergieValide("x".repeat(121))).toBeNull();
    expect(allergieValide(42)).toBeNull();
  });
});

describe("allergie de la commande", () => {
  it("est enregistrée sur la commande pour la cuisine", async () => {
    const r = await (await commander({ allergie: "Arachides (enfant de 6 ans)" })).json();
    expect(r.redirection).toMatch(/\/suivi\//);
    expect(await allergieDe(r.redirection)).toBe("Arachides (enfant de 6 ans)");
  });

  it("vide quand le client n'en signale pas", async () => {
    const r = await (await commander({})).json();
    expect(await allergieDe(r.redirection)).toBe("");
  });

  it("trop longue : la commande est refusée avec une raison, rien n'est tronqué en silence", async () => {
    const rep = await commander({ allergie: "x".repeat(121) });
    expect(rep.status).toBe(422);
    expect((await rep.json()).erreur).toMatch(/120 caractères/);
  });

  it("n'est jamais copiée dans le compte du client", async () => {
    const db = await baseLocale();
    const colonnes = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name in ('comptes', 'adresses_compte')")).rows.map((c) => c.column_name);
    expect(colonnes.some((c) => c.includes("allerg"))).toBe(false);
  });
});
