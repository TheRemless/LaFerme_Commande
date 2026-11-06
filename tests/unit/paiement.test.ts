import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { commandeParId, creerCommande, lierSessionPaiement } from "@/lib/db/serveur";

// Clés factices de test : le SDK Stripe sait signer un événement sans compte ni réseau.
process.env.STRIPE_SECRET_KEY = "sk_test_factice";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_factice";
const stripe = new Stripe("sk_test_factice");

let POST: (r: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
});

async function nouvelleCommande() {
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "retrait",
    statut: "paiement_en_attente",
    statut_paiement: "en_attente",
    moyen_paiement: "en_ligne",
    client_prenom: "Test",
    client_nom: "Essai",
    client_telephone: "079 000 00 00",
    client_email: "test@exemple.ch",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1000,
    frais_centimes: 0,
    total_centimes: 1000,
    tva_centimes: 25,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
  });
  await lierSessionPaiement(c.id, `cs_test_${cle}`);
  return { ...c, session: `cs_test_${cle}` };
}

function evenement(id: string, type: string, commande: string, paye = true, session = "cs_test") {
  return JSON.stringify({
    id,
    object: "event",
    type,
    data: { object: { object: "checkout.session", id: session, metadata: { commande_id: commande }, payment_status: paye ? "paid" : "unpaid", payment_intent: "pi_test" } },
  });
}

async function envoyer(corps: string, signer = true) {
  const signature = signer ? stripe.webhooks.generateTestHeaderString({ payload: corps, secret: "whsec_factice" }) : "t=1,v1=faux";
  return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: corps, headers: { "stripe-signature": signature } }));
}

async function nbCourriels(commande: string) {
  const db = await baseLocale();
  return (await db.query<{ n: number }>("select count(*)::int as n from courriels where commande_id = $1", [commande])).rows[0].n;
}

describe("webhook Stripe", () => {
  it("refuse une signature fausse", async () => {
    const c = await nouvelleCommande();
    expect((await envoyer(evenement("evt_1", "checkout.session.completed", c.id), false)).status).toBe(400);
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
  });

  it("confirme le paiement une seule fois et n'envoie qu'un courriel", async () => {
    const c = await nouvelleCommande();
    const ev = evenement(`evt_${c.id}`, "checkout.session.completed", c.id);
    expect((await envoyer(ev)).status).toBe(200);
    await envoyer(ev);
    await envoyer(evenement(`evt_bis_${c.id}`, "checkout.session.async_payment_succeeded", c.id));
    const apres = await commandeParId(c.id);
    expect(apres?.statut).toBe("nouvelle");
    expect(apres?.statut_paiement).toBe("paye");
    expect(await nbCourriels(c.id)).toBe(1);
  });

  it("attend TWINT quand la session est terminée sans paiement", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_u_${c.id}`, "checkout.session.completed", c.id, false));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
  });

  it("n'annule jamais une commande déjà payée", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_p_${c.id}`, "checkout.session.completed", c.id));
    await envoyer(evenement(`evt_x_${c.id}`, "checkout.session.expired", c.id, false));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("paye");
  });
});

describe("expiration d'une session", () => {
  it("annule la commande si c'est sa session en cours, pas si c'est un ancien essai", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_vieux_${c.id}`, "checkout.session.expired", c.id, false, "cs_test_ancien"));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
    await envoyer(evenement(`evt_exp_${c.id}`, "checkout.session.expired", c.id, false, c.session));
    expect((await commandeParId(c.id))?.statut).toBe("annulee");
  });
});
