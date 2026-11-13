import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// « +N min sur les commandes en cours » depuis la tablette (vague 3, P0 de produit-gestion ; serveur de bo-operations).

const session = vi.hoisted(() => ({ personnel: { id: "", email: "", nom: "", role: "service" as const } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET, POST } = await import("@/app/api/tablette/decaler/route");
const poster = (corps: unknown) => POST(new Request("http://localhost/api/tablette/decaler", { method: "POST", body: JSON.stringify(corps) }));

describe("décaler depuis la tablette", () => {
  it("aperçu, puis un seul décalage par clé, et les bornes", async () => {
    const db = await baseLocale();
    session.personnel = { ...session.personnel, id: (await db.query<{ id: string }>("select id from personnel where role = 'service' and actif limit 1")).rows[0].id };
    const heure = new Date(Math.ceil((Date.now() + 30 * 60_000) / 300_000) * 300_000).toISOString();
    const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [{
      jeton_suivi: `j-dec-${Date.now()}`, cle_idempotence: `dec-${Date.now()}`, mode: "retrait", statut: "acceptee", statut_paiement: "paye", moyen_paiement: "en_ligne",
      client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 444 55 66", client_email: "dec@laferme.test", quand_type: "asap", pizzas_seulement: true,
      sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 26, taux_tva_pourcent: 2.6, origine: "http://localhost",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
    }])).rows[0].id;
    await db.query("update commandes set heure_confirmee = $2 where id = $1", [id, heure]);

    const apercu = (await (await GET(new Request("http://localhost/api/tablette/decaler"))).json()) as { commandes: number; clients: number };
    expect(apercu.commandes).toBeGreaterThanOrEqual(1);

    const cle = `cle-${Date.now()}`;
    const r = await poster({ minutes: 10, cle });
    expect(r.status).toBe(200);
    expect((await r.json()) as { ok: boolean; commandes: number }).toMatchObject({ ok: true, deja: false });
    const apres = (await db.query<{ h: string }>("select heure_confirmee::text as h from commandes where id = $1", [id])).rows[0].h;
    expect(new Date(apres).getTime() - new Date(heure).getTime()).toBe(10 * 60_000);
    // Double appui : même clé, aucun nouveau décalage.
    expect((await (await poster({ minutes: 10, cle })).json()) as { deja: boolean }).toMatchObject({ deja: true });
    expect((await db.query<{ h: string }>("select heure_confirmee::text as h from commandes where id = $1", [id])).rows[0].h).toBe(apres);

    expect((await poster({ minutes: 200, cle: `x-${Date.now()}` })).status).toBe(422);
    expect((await poster({ minutes: 10, station: "bar", cle: `y-${Date.now()}` })).status).toBe(422);
  });
});
