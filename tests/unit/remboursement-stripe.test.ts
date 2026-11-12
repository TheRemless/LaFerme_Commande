import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";

// Audit de sécurité 2, S2-03 : un remboursement Stripe n'est « fait » que quand Stripe dit « succeeded ».
// En attente : la ligne reste « en cours » et l'export ne la compte pas. Échec annoncé plus tard par le
// webhook (charge.refund.updated) : la ligne passe en échec et le restaurant est alerté, une seule fois.
// Paiements de la doublure (pi_doublure_…) : aucun appel réseau. Montants d'essai, pas des prix de la carte.

process.env.STRIPE_SECRET_KEY = "sk_test_factice";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_factice";
delete process.env.ALERTE_EMAIL;
const stripe = new Stripe("sk_test_factice");

let POST: (r: Request) => Promise<Response>;
let commandes: typeof import("@/lib/commandes");
let paiement: typeof import("@/lib/paiement/passerelle");
let gerant: string;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
  commandes = await import("@/lib/commandes");
  paiement = await import("@/lib/paiement/passerelle");
  const db = await baseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});
afterEach(() => {
  delete process.env.DOUBLURE_REMBOURSEMENT;
});

async function commandePayee(statut: "terminee" | "nouvelle") {
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Essai",
    client_nom: "Remboursement",
    client_telephone: "079 000 00 00",
    client_email: `rb-${cle.slice(0, 8)}@exemple.ch`,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 4000,
    frais_centimes: 0,
    total_centimes: 4000,
    tva_centimes: 102,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  });
  const db = await baseLocale();
  await db.query("update commandes set statut = $2, stripe_payment_intent = $3, jour_service = (now() at time zone 'Europe/Zurich')::date where id = $1", [c.id, statut, `pi_doublure_${cle}`]);
  return c.id;
}

async function lignes(commande: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; stripe_refund_id: string | null; erreur: string | null; montant_centimes: number }>(
    "select statut, stripe_refund_id, erreur, montant_centimes from remboursements where commande_id = $1 order by cree_le",
    [commande],
  )).rows;
}
async function alertes(numero: number) {
  const db = await baseLocale();
  return (await db.query<{ n: number }>("select count(*)::int n from courriels where sujet = $1", [`Commande ${numero} : remboursement échoué chez Stripe`])).rows[0].n;
}
async function numero(commande: string) {
  return (await (await baseLocale()).query<{ numero: number }>("select numero from commandes where id = $1", [commande])).rows[0].numero;
}
async function exporte(commande: string) {
  const db = await baseLocale();
  const n = await numero(commande);
  const r = (await db.query<{ e: { numero: number }[] }>("select export_remboursements((now() at time zone 'Europe/Zurich')::date, (now() at time zone 'Europe/Zurich')::date) e")).rows[0].e;
  return r.some((x) => x.numero === n);
}

function evenementRefund(id: string, refund: string, status: string, raison: string | null = null) {
  return JSON.stringify({
    id,
    object: "event",
    type: "charge.refund.updated",
    data: { object: { object: "refund", id: refund, status, failure_reason: raison, amount: 1500, currency: "chf", payment_intent: "pi_x" } },
  });
}
async function envoyer(corps: string, signer = true) {
  const signature = signer ? stripe.webhooks.generateTestHeaderString({ payload: corps, secret: "whsec_factice" }) : "t=1,v1=faux";
  return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: corps, headers: { "stripe-signature": signature } }));
}

describe("S2-03 : la passerelle rend l'état du remboursement", () => {
  it("doublure : « succeeded » par défaut, « pending » sur demande", () => {
    expect(paiement.remboursementSimule("pi_doublure_a", "cle-a")).toEqual({ id: "re_doublure_cle-a", statut: "succeeded" });
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    expect(paiement.remboursementSimule("pi_doublure_a", "cle-a")).toEqual({ id: "re_doublure_cle-a", statut: "pending" });
  });
});

describe("S2-03 : remboursement après coup", () => {
  it("en attente chez Stripe : la ligne reste en cours, hors de l'export, puis devient faite au webhook", async () => {
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    const c = await commandePayee("terminee");
    const r = await commandes.rembourserApresCoup(c, 1500, "Plat froid.", `cle-${randomUUID()}`, gerant);
    expect(r.ok).toBe(true);
    const [l] = await lignes(c);
    expect(l.statut).toBe("en_cours");
    expect(l.stripe_refund_id).toMatch(/^re_doublure_/);
    expect(await exporte(c)).toBe(false);

    expect((await envoyer(evenementRefund("evt_rb_1", l.stripe_refund_id!, "succeeded"))).status).toBe(200);
    expect((await lignes(c))[0].statut).toBe("fait");
    expect(await exporte(c)).toBe(true);
  });

  it("échec annoncé plus tard : ligne en échec, hors de l'export, une seule alerte au restaurant", async () => {
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    const c = await commandePayee("terminee");
    await commandes.rembourserApresCoup(c, 1500, "Plat froid.", `cle-${randomUUID()}`, gerant);
    const refund = (await lignes(c))[0].stripe_refund_id!;

    expect((await envoyer(evenementRefund("evt_rb_2", refund, "failed", "insufficient_funds"))).status).toBe(200);
    expect(await envoyer(evenementRefund("evt_rb_3", refund, "failed", "insufficient_funds"))).toHaveProperty("status", 200);
    const [l] = await lignes(c);
    expect(l.statut).toBe("echec");
    expect(l.erreur).toContain("insufficient_funds");
    expect(await exporte(c)).toBe(false);
    expect(await alertes(await numero(c))).toBe(1);
    // Un « succeeded » arrivé après l'échec ne la ressuscite pas.
    await envoyer(evenementRefund("evt_rb_4", refund, "succeeded"));
    expect((await lignes(c))[0].statut).toBe("echec");
  });

  it("échec annoncé après un « succeeded » : la ligne faite repasse en échec, sort de l'export, une alerte", async () => {
    const c = await commandePayee("terminee");
    await commandes.rembourserApresCoup(c, 1500, "Plat froid.", `cle-${randomUUID()}`, gerant);
    const [l] = await lignes(c);
    expect(l.statut).toBe("fait");
    expect(await exporte(c)).toBe(true);
    await envoyer(evenementRefund("evt_rb_8", l.stripe_refund_id!, "failed", "lost_or_stolen_card"));
    expect((await lignes(c))[0].statut).toBe("echec");
    expect(await exporte(c)).toBe(false);
    expect(await alertes(await numero(c))).toBe(1);
  });

  it("relancer une ligne déjà partie chez Stripe ne redemande rien à Stripe", async () => {
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    const c = await commandePayee("terminee");
    const cle = `cle-${randomUUID()}`;
    await commandes.rembourserApresCoup(c, 1500, "Plat froid.", cle, gerant);
    const r = await commandes.rembourserApresCoup(c, 1500, "Plat froid.", cle, gerant);
    expect(r).toMatchObject({ ok: false, enCours: true });
    expect(await lignes(c)).toHaveLength(1);
  });

  it("confirmé tout de suite par Stripe : fait comme avant", async () => {
    const c = await commandePayee("terminee");
    expect((await commandes.rembourserApresCoup(c, 1500, "Plat froid.", `cle-${randomUUID()}`, gerant)).ok).toBe(true);
    expect((await lignes(c))[0].statut).toBe("fait");
    expect(await exporte(c)).toBe(true);
  });
});

describe("S2-03 : remboursement d'une commande refusée", () => {
  it("en attente : le client lit la même chose qu'avant, la ligne reste en cours, l'échec alerte le restaurant", async () => {
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    const c = await commandePayee("nouvelle");
    const db = await baseLocale();
    await db.query("update commandes set statut = 'refusee', motif = 'Fermé.' where id = $1", [c]);
    expect((await commandes.rembourserCommande(c, "Fermé.")).rembourse).toBe(true);
    expect((await db.query<{ s: string }>("select statut_paiement s from commandes where id = $1", [c])).rows[0].s).toBe("rembourse");
    const [l] = await lignes(c);
    expect(l).toMatchObject({ statut: "en_cours", montant_centimes: 4000 });

    await envoyer(evenementRefund("evt_rb_5", l.stripe_refund_id!, "failed", "expired_or_canceled_card"));
    expect((await lignes(c))[0].statut).toBe("echec");
    expect(await alertes(await numero(c))).toBe(1);
  });

  it("refus après un manque déjà rendu : la ligne note ce qui restait, pas le total", async () => {
    const c = await commandePayee("terminee");
    await commandes.rembourserApresCoup(c, 1500, "Plat froid.", `cle-${randomUUID()}`, gerant);
    const db = await baseLocale();
    await db.query("update commandes set statut = 'refusee', motif = 'Fermé.' where id = $1", [c]);
    expect((await commandes.rembourserCommande(c, "Fermé.")).rembourse).toBe(true);
    expect((await lignes(c)).map((x) => x.montant_centimes)).toEqual([1500, 2500]);
  });

  it("confirmé tout de suite : ligne faite", async () => {
    const c = await commandePayee("nouvelle");
    await (await baseLocale()).query("update commandes set statut = 'refusee', motif = 'Fermé.' where id = $1", [c]);
    expect((await commandes.rembourserCommande(c, "Fermé.")).rembourse).toBe(true);
    expect((await lignes(c))[0].statut).toBe("fait");
  });
});

describe("S2-03 : webhook", () => {
  it("signature fausse : refusé, rien n'est appliqué", async () => {
    expect((await envoyer(evenementRefund("evt_rb_6", "re_inconnu", "failed"), false)).status).toBe(400);
  });

  it("remboursement inconnu (fait dans le tableau de bord Stripe) : reçu, sans effet", async () => {
    expect((await envoyer(evenementRefund("evt_rb_7", "re_inconnu_tableau", "succeeded"))).status).toBe(200);
  });
});
