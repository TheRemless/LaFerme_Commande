import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Revue de sécurité de client-compte (15.11.2026) : au retour arrière depuis Stripe, la route crée une nouvelle
// session pour la même commande. Elle doit être liée à la commande AVANT que l'ancienne soit expirée : sinon le
// webhook « expired » de l'ancienne peut annuler la commande entre les deux.
const ordre: string[] = [];
let n = 0;
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  paiementDisponible: () => true,
  passerelle: () => ({
    nom: "stripe",
    async creerSession(p: { commandeId: string }) {
      n += 1;
      ordre.push(`creer:${n}`);
      return { id: `cs_retour_${p.commandeId}_${n}`, url: `https://checkout.stripe.test/${n}` };
    },
    async expirerSession(id: string) {
      const db = await baseLocale();
      const commande = id.replace(/^cs_retour_/, "").replace(/_\d+$/, "");
      const liee = (await db.query<{ s: string }>("select stripe_session_id as s from commandes where id = $1", [commande])).rows[0].s;
      ordre.push(`expirer:${id === liee ? "encore-liee" : "deja-remplacee"}`);
    },
    async lireSession() {
      return { statut: "en_attente", montantCentimes: null, devise: null };
    },
    async rembourser() {
      throw new Error("non utilisé");
    },
  }),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

async function commander(cle: string) {
  const { POST } = await import("@/app/api/commandes/route");
  return POST(
    new Request("http://localhost:3000/api/commandes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        cle,
        lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
        mode: "retrait",
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        client: { prenom: "Retour", nom: "Stripe", telephone: "079 555 44 33", email: `retour-${cle.slice(0, 8)}@laferme.test` },
        moyen: "en_ligne",
      }),
    }),
  );
}

describe("retour arrière depuis Stripe", () => {
  it("la nouvelle session est liée avant que l'ancienne soit expirée", async () => {
    const cle = randomUUID();
    const premiere = await commander(cle);
    expect(premiere.status, await premiere.clone().text()).toBe(200);
    ordre.length = 0;
    const seconde = await commander(cle);
    expect(seconde.status, await seconde.clone().text()).toBe(200);
    expect(ordre).toEqual([expect.stringMatching(/^creer:/), "expirer:deja-remplacee"]);
  });
});
