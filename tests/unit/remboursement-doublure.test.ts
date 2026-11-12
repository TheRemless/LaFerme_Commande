import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";

// Audit de sécurité 2, S2-03 : sans Stripe (poste local, préversion sur une base de test), la doublure joue un
// remboursement « en attente » puis le termine par /api/paiement-test, comme le webhook. Montants d'essai.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.ALERTE_EMAIL;
process.env.CONTEXTE_DEPLOIEMENT = "local";

let POST: (r: Request) => Promise<Response>;
let commandes: typeof import("@/lib/commandes");
let gerant: string;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/paiement-test/route"));
  commandes = await import("@/lib/commandes");
  gerant = (await (await baseLocale()).query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});
afterEach(() => {
  delete process.env.DOUBLURE_REMBOURSEMENT;
});

const finir = (corps: unknown) => POST(new Request("http://localhost/api/paiement-test", { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } }));

async function ligneEnAttente(): Promise<{ commande: string; refund: string }> {
  process.env.DOUBLURE_REMBOURSEMENT = "pending";
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`, cle_idempotence: cle, mode: "retrait", statut: "nouvelle", statut_paiement: "paye", moyen_paiement: "en_ligne",
    client_prenom: "Essai", client_nom: "Doublure", client_telephone: "079 000 00 00", client_email: "doublure@exemple.ch", quand_type: "asap",
    pizzas_seulement: true, sous_total_centimes: 3000, frais_centimes: 0, total_centimes: 3000, tva_centimes: 76, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 3000, total_centimes: 3000, choix: {}, retraits: [], note: "" }],
  });
  const db = await baseLocale();
  await db.query("update commandes set statut = 'terminee', stripe_payment_intent = $2 where id = $1", [c.id, `pi_doublure_${cle}`]);
  expect((await commandes.rembourserApresCoup(c.id, 1000, "Essai doublure.", `cle-${cle}`, gerant)).ok).toBe(true);
  const refund = (await db.query<{ r: string }>("select stripe_refund_id r from remboursements where commande_id = $1", [c.id])).rows[0].r;
  return { commande: c.id, refund };
}
const statut = async (commande: string) => (await (await baseLocale()).query<{ s: string }>("select statut s from remboursements where commande_id = $1", [commande])).rows[0].s;

describe("S2-03 : la doublure termine un remboursement en attente", () => {
  it("« echec » passe la ligne en échec, une seule fois", async () => {
    const { commande, refund } = await ligneEnAttente();
    expect(await statut(commande)).toBe("en_cours");
    expect(await (await finir({ remboursement: refund, issue: "echec" })).json()).toEqual({ change: true });
    expect(await (await finir({ remboursement: refund, issue: "echec" })).json()).toEqual({ change: false });
    expect(await statut(commande)).toBe("echec");
  });

  it("« fait » passe la ligne à faite", async () => {
    const { commande, refund } = await ligneEnAttente();
    await finir({ remboursement: refund, issue: "fait" });
    expect(await statut(commande)).toBe("fait");
  });

  it("un identifiant qui n'est pas celui de la doublure est refusé", async () => {
    expect((await finir({ remboursement: "re_3Abc", issue: "fait" })).status).toBe(404);
    expect((await finir({ remboursement: "re_doublure_x", issue: "rembourse" })).status).toBe(404);
  });
});
