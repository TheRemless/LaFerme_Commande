import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { destinataireValide } from "@/lib/validation";

// Vague 3, client-commande : commander pour quelqu'un d'autre. Celui qui commande paie et reçoit les e-mails ;
// la personne qui reçoit (livraison) ou vient chercher (à emporter) a son nom et son téléphone sur la commande.

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
        client: { prenom: "Léa", nom: "Rochat", telephone: "079 000 00 00", email: `autrui-${randomUUID().slice(0, 8)}@laferme.test` },
        moyen: "comptoir",
        ...corps,
      }),
    }),
  );
}

async function destinataireDe(redirection: string) {
  const jeton = redirection.split("/suivi/")[1];
  const db = await baseLocale();
  return (await db.query<{ destinataire: unknown }>("select destinataire from commandes where jeton_suivi = $1", [jeton])).rows[0].destinataire;
}

describe("destinataireValide", () => {
  it("absent : null, la commande est pour soi", () => {
    expect(destinataireValide(undefined)).toBeNull();
    expect(destinataireValide(null)).toBeNull();
  });
  it("garde le nom et le téléphone nettoyés", () => {
    expect(destinataireValide({ nom: "  Marc   Rochat ", telephone: "079 111 22 33" })).toEqual({ nom: "Marc Rochat", telephone: "079 111 22 33" });
  });
  it("refuse un nom vide ou un téléphone faux", () => {
    expect(destinataireValide({ nom: "", telephone: "079 111 22 33" })).toBe("nom");
    expect(destinataireValide({ nom: "Marc", telephone: "123" })).toBe("telephone");
  });
});

describe("commande pour quelqu'un d'autre", () => {
  it("garde la personne qui vient chercher la commande", async () => {
    const r = await (await commander({ destinataire: { nom: "Marc Rochat", telephone: "079 111 22 33" } })).json();
    expect(await destinataireDe(r.redirection)).toEqual({ nom: "Marc Rochat", telephone: "079 111 22 33" });
  });
  it("sans destinataire, rien n'est gardé", async () => {
    const r = await (await commander({})).json();
    expect(await destinataireDe(r.redirection)).toBeNull();
  });
  it("téléphone faux : refus nommé", async () => {
    const rep = await commander({ destinataire: { nom: "Marc", telephone: "12" } });
    expect(rep.status).toBe(422);
    expect((await rep.json()).erreur).toMatch(/téléphone de la personne/);
  });
});
