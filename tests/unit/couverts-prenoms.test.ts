import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { lignesValides } from "@/lib/validation";

// Vague 3, client-commande : couverts (C8) et prénom par ligne (C5), construits mais éteints par défaut.

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
process.env.SANS_LIMITE_COMPTOIR = "1";
let POST: (r: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/commandes/route"));
});
afterAll(async () => {
  await regler("couverts_actifs", false);
  await regler("prenom_par_ligne_actif", false);
});

async function regler(cle: string, valeur: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);
}

async function commander() {
  const rep = await POST(
    new Request("http://localhost:3000/api/commandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cle: randomUUID(),
        lignes: [
          { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "", pour: "Léa" },
          { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "", pour: "Marc" },
        ],
        mode: "retrait",
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        client: { prenom: "Test", nom: "Famille", telephone: "079 000 00 00", email: `famille-${randomUUID().slice(0, 8)}@laferme.test` },
        moyen: "comptoir",
        couverts: true,
      }),
    }),
  );
  const jeton = ((await rep.json()) as { redirection: string }).redirection.split("/suivi/")[1];
  const db = await baseLocale();
  const c = (await db.query<{ id: string; couverts: boolean }>("select id, couverts from commandes where jeton_suivi = $1", [jeton])).rows[0];
  const pour = (await db.query<{ pour: string }>("select pour from commande_lignes where commande_id = $1 order by position", [c.id])).rows.map((r) => r.pour);
  return { couverts: c.couverts, pour };
}

describe("couverts et prénoms par ligne", () => {
  it("éteints par défaut : rien n'est gardé, même si le navigateur l'envoie", async () => {
    expect(await commander()).toEqual({ couverts: false, pour: ["", ""] });
  });

  it("allumés : couverts demandés et un prénom par ligne", async () => {
    await regler("couverts_actifs", true);
    await regler("prenom_par_ligne_actif", true);
    expect(await commander()).toEqual({ couverts: true, pour: ["Léa", "Marc"] });
  });

  it("le prénom est nettoyé et limité à 30 caractères", () => {
    expect(lignesValides([{ slug: "x", qte: 1, choix: {}, retraits: [], note: "", pour: "  Léa\u0007  " }])?.[0].pour).toBe("Léa");
    expect(lignesValides([{ slug: "x", qte: 1, choix: {}, retraits: [], note: "", pour: "x".repeat(31) }])).toBeNull();
  });
});
