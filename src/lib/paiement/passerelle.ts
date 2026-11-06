import "server-only";
import Stripe from "stripe";

// Paiement en ligne. Stripe Checkout en vrai (TWINT, cartes, Apple Pay et Google Pay selon ce qui est
// activé dans le tableau de bord Stripe). Sans clé Stripe, hors production : une doublure qui simule la
// page de paiement, pour construire et tester le parcours avant que Jérémy ait son compte.

export type LigneFacture = { libelle: string; qte: number; unitaire_centimes: number };

export type DemandeSession = {
  commandeId: string;
  numero: number;
  email: string;
  lignes: LigneFacture[];
  urlRetour: string;
  urlAnnulation: string;
  origine: string;
};

export type EtatSession = { statut: "paye" | "en_attente" | "echec"; paymentIntent?: string };

export interface Passerelle {
  nom: "stripe" | "doublure";
  creerSession(d: DemandeSession): Promise<{ id: string; url: string }>;
  lireSession(id: string): Promise<EtatSession>;
  rembourser(paymentIntent: string): Promise<{ id: string }>;
  expirerSession(id: string): Promise<void>;
}

let stripe: Stripe | null = null;

export function clientStripe(): Stripe | null {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return null;
  // Garde-fou : une clé de production ne sert qu'en production, et une préversion n'accepte que des clés de test.
  const enProduction = process.env.CONTEXTE_DEPLOIEMENT === "production";
  if (!enProduction && !cle.startsWith("sk_test_") && !cle.startsWith("rk_test_")) {
    throw new Error("Clé Stripe de production refusée hors production.");
  }
  stripe ??= new Stripe(cle);
  return stripe;
}

const passerelleStripe = (s: Stripe): Passerelle => ({
  nom: "stripe",
  async creerSession(d) {
    const session = await s.checkout.sessions.create(
      {
        mode: "payment",
        currency: "chf",
        locale: "fr",
        customer_email: d.email,
        client_reference_id: d.commandeId,
        metadata: { commande_id: d.commandeId },
        payment_intent_data: { metadata: { commande_id: d.commandeId }, description: `La Ferme, commande ${d.numero}` },
        line_items: d.lignes.map((l) => ({
          quantity: l.qte,
          price_data: { currency: "chf", unit_amount: l.unitaire_centimes, product_data: { name: l.libelle.slice(0, 250) } },
        })),
        success_url: d.urlRetour,
        cancel_url: d.urlAnnulation,
        // Une demi-heure (minimum Stripe) : au-delà, la session expire et la commande est annulée.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
    );
    if (!session.url) throw new Error("Stripe n'a pas renvoyé d'adresse de paiement.");
    return { id: session.id, url: session.url };
  },
  async lireSession(id) {
    const session = await s.checkout.sessions.retrieve(id);
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (session.payment_status === "paid") return { statut: "paye", paymentIntent };
    if (session.status === "expired") return { statut: "echec" };
    return { statut: "en_attente" };
  },
  async rembourser(paymentIntent) {
    const r = await s.refunds.create({ payment_intent: paymentIntent }, { idempotencyKey: `remboursement-${paymentIntent}` });
    return { id: r.id };
  },
  async expirerSession(id) {
    const session = await s.checkout.sessions.retrieve(id);
    if (session.status === "open") await s.checkout.sessions.expire(id);
  },
});

const passerelleDoublure: Passerelle = {
  nom: "doublure",
  async creerSession(d) {
    const id = `doublure_${d.commandeId}`;
    return { id, url: `${d.origine}/paiement-test/${d.commandeId}` };
  },
  // L'état vit dans la base (événements appliqués par la page de test) : rien à relire ailleurs.
  async lireSession() {
    return { statut: "en_attente" };
  },
  async rembourser(paymentIntent) {
    return { id: `re_doublure_${paymentIntent}` };
  },
  async expirerSession() {},
};

export function passerelle(): Passerelle {
  const s = clientStripe();
  if (s) return passerelleStripe(s);
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error("STRIPE_SECRET_KEY manquante en production.");
  return passerelleDoublure;
}
