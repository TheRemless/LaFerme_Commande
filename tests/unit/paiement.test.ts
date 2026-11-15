import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { commandeParId, creerCommande, lierSessionPaiement } from "@/lib/db/serveur";

// Clés factices de test : le SDK Stripe sait signer un événement sans compte ni réseau.
process.env.STRIPE_SECRET_KEY = "sk_test_factice";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_factice";
const stripe = new Stripe("sk_test_factice");

// Sessions fermées par le serveur (deux onglets) : notées ici, sans appel à Stripe.
const expirees: string[] = [];
vi.mock("@/lib/paiement/passerelle", async (original) => {
  const vrai = await original<typeof import("@/lib/paiement/passerelle")>();
  return {
    ...vrai,
    passerelle: () => ({
      ...vrai.passerelle(),
      async expirerSession(id: string) {
        expirees.push(id);
      },
    }),
  };
});

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

// Un paiement par session : le remboursement d'un paiement hors commande se simule (pi_doublure_), sans réseau.
function evenement(id: string, type: string, commande: string, paye = true, session = "cs_test", montant = 1000, devise = "chf") {
  return JSON.stringify({
    id,
    object: "event",
    type,
    data: { object: { object: "checkout.session", id: session, metadata: { commande_id: commande }, payment_status: paye ? "paid" : "unpaid", payment_intent: `pi_doublure_${session}_${montant}_${devise}`, amount_total: montant, currency: devise } },
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
    const ev = evenement(`evt_${c.id}`, "checkout.session.completed", c.id, true, c.session);
    expect((await envoyer(ev)).status).toBe(200);
    await envoyer(ev);
    await envoyer(evenement(`evt_bis_${c.id}`, "checkout.session.async_payment_succeeded", c.id, true, c.session));
    const apres = await commandeParId(c.id);
    expect(apres?.statut).toBe("nouvelle");
    expect(apres?.statut_paiement).toBe("paye");
    expect(await nbCourriels(c.id)).toBe(1);
  });

  it("attend TWINT quand la session est terminée sans paiement", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_u_${c.id}`, "checkout.session.completed", c.id, false, c.session));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
  });

  it("n'annule jamais une commande déjà payée", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_p_${c.id}`, "checkout.session.completed", c.id, true, c.session));
    await envoyer(evenement(`evt_x_${c.id}`, "checkout.session.expired", c.id, false, c.session));
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

async function orphelins(commande: string) {
  const db = await baseLocale();
  return (await db.query<{ payment_intent: string; rembourse: boolean }>(
    "select payment_intent, rembourse_le is not null as rembourse from paiements_orphelins where commande_id = $1 order by payment_intent",
    [commande],
  )).rows;
}
async function alertes(numero: number) {
  const db = await baseLocale();
  return (await db.query<{ sujet: string }>("select sujet from courriels where commande_id is null and sujet like $1", [`Commande ${numero} : paiement en trop%`])).rows;
}

describe("paiement qui ne correspond pas à la commande", () => {
  it("ne confirme ni un montant inférieur, ni une autre devise, ni une autre session : chacun est remboursé", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_m_${c.id}`, "checkout.session.completed", c.id, true, c.session, 100));
    await envoyer(evenement(`evt_d_${c.id}`, "checkout.session.completed", c.id, true, c.session, 1000, "eur"));
    await envoyer(evenement(`evt_s_${c.id}`, "checkout.session.completed", c.id, true, "cs_test_etrangere"));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
    // Aucune confirmation : seulement trois e-mails « remboursé », un par paiement, et trois alertes.
    const db = await baseLocale();
    const sujets = (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1", [c.id])).rows.map((r) => r.sujet);
    expect(sujets).toHaveLength(3);
    expect(sujets.every((x) => x.includes("remboursé"))).toBe(true);
    expect((await orphelins(c.id)).every((o) => o.rembourse)).toBe(true);
    expect(await alertes(c.numero)).toHaveLength(3);
  });
});

// Revue de sécurité de client-compte (15.11.2026) : au retour arrière depuis Stripe, l'ancienne session était
// expirée avant que la nouvelle soit liée.
describe("retour arrière depuis Stripe", () => {
  it("la course rejouée : l'expiration de l'ancienne session n'annule pas la commande liée à la nouvelle", async () => {
    const c = await nouvelleCommande();
    const nouvelle = `${c.session}_bis`;
    // Ordre de la route : la nouvelle session est liée, puis l'ancienne expirée ; son webhook arrive ensuite.
    await lierSessionPaiement(c.id, nouvelle);
    await envoyer(evenement(`evt_exp_anc_${c.id}`, "checkout.session.expired", c.id, false, c.session));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
    await envoyer(evenement(`evt_ok_${c.id}`, "checkout.session.completed", c.id, true, nouvelle));
    const apres = await commandeParId(c.id);
    expect(apres).toMatchObject({ statut: "nouvelle", statut_paiement: "paye", stripe_session_id: nouvelle });
    expect(await orphelins(c.id)).toEqual([]);
  });

  it("même lu avant la liaison, le webhook d'expiration est revérifié en base sous verrou", async () => {
    const c = await nouvelleCommande();
    const db = await baseLocale();
    // Le webhook a lu la commande quand l'ancienne session était encore la sienne, la liaison passe, puis il annule.
    await lierSessionPaiement(c.id, `${c.session}_bis`);
    expect((await db.query<{ r: boolean }>("select annuler_paiement_session($1, $2, $3) as r", [`evt_course_${c.id}`, c.id, c.session])).rows[0].r).toBe(false);
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
  });

  it("filet : un paiement réussi sur une commande annulée est remboursé, gérant et client prévenus une seule fois", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_exp_${c.id}`, "checkout.session.expired", c.id, false, c.session));
    expect((await commandeParId(c.id))?.statut).toBe("annulee");
    const paye = evenement(`evt_tard_${c.id}`, "checkout.session.completed", c.id, true, c.session);
    await envoyer(paye);
    await envoyer(paye);
    expect((await commandeParId(c.id))?.statut).toBe("annulee");
    expect(await orphelins(c.id)).toEqual([{ payment_intent: `pi_doublure_${c.session}_1000_chf`, rembourse: true }]);
    expect(await alertes(c.numero)).toHaveLength(1);
    const db = await baseLocale();
    const client = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1", [c.id])).rows;
    expect(client).toHaveLength(1);
    expect(client[0].texte).toContain("après son annulation");
  });

  it("filet : une commande refusée et remboursée n'est pas remboursée une seconde fois par un webhook rejoué", async () => {
    const c = await nouvelleCommande();
    const ev = evenement(`evt_p2_${c.id}`, "checkout.session.completed", c.id, true, c.session);
    await envoyer(ev);
    const db = await baseLocale();
    await db.query("update commandes set statut = 'refusee', statut_paiement = 'rembourse' where id = $1", [c.id]);
    await envoyer(evenement(`evt_p3_${c.id}`, "checkout.session.async_payment_succeeded", c.id, true, c.session));
    expect(await orphelins(c.id)).toEqual([]);
  });

  it("deux onglets : l'ancienne session payée au bon montant confirme la commande, la courante est fermée", async () => {
    const c = await nouvelleCommande();
    const courante = `${c.session}_onglet2`;
    await lierSessionPaiement(c.id, courante);
    // Le client paie dans le premier onglet, celui de la session qui n'est plus la courante.
    await envoyer(evenement(`evt_onglet1_${c.id}`, "checkout.session.completed", c.id, true, c.session));
    const apres = await commandeParId(c.id);
    expect(apres).toMatchObject({ statut: "nouvelle", statut_paiement: "paye", stripe_session_id: c.session, stripe_payment_intent: `pi_doublure_${c.session}_1000_chf` });
    expect(expirees).toContain(courante);
    expect(await orphelins(c.id)).toEqual([]);
    expect(await alertes(c.numero)).toEqual([]);
    const db = await baseLocale();
    expect((await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1", [c.id])).rows).toHaveLength(1);
    // Il paie quand même le second onglet : ce second paiement est remboursé, la commande reste confirmée.
    await envoyer(evenement(`evt_onglet2_${c.id}`, "checkout.session.completed", c.id, true, courante));
    expect(await commandeParId(c.id)).toMatchObject({ statut_paiement: "paye", stripe_session_id: c.session });
    expect(await orphelins(c.id)).toEqual([{ payment_intent: `pi_doublure_${courante}_1000_chf`, rembourse: true }]);
    const client = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1 order by envoye_le", [c.id])).rows;
    expect(client.at(-1)?.texte).toContain("second paiement");
  });

  it("deux onglets : une session qui n'a pas été créée pour cette commande ne la confirme jamais", async () => {
    const c = await nouvelleCommande();
    await envoyer(evenement(`evt_inconnue_${c.id}`, "checkout.session.completed", c.id, true, "cs_test_jamais_creee"));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
    expect(await orphelins(c.id)).toHaveLength(1);
  });

  it("deux onglets : au mauvais montant, l'ancienne session est remboursée, pas prise", async () => {
    const c = await nouvelleCommande();
    await lierSessionPaiement(c.id, `${c.session}_onglet2`);
    await envoyer(evenement(`evt_onglet1m_${c.id}`, "checkout.session.completed", c.id, true, c.session, 900));
    expect((await commandeParId(c.id))?.statut_paiement).toBe("en_attente");
    expect(await orphelins(c.id)).toHaveLength(1);
  });
});
