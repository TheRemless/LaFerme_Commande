import "server-only";
import Stripe from "stripe";
import { baseDeTest } from "@/lib/environnement";

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

export type EtatSession = {
  statut: "paye" | "en_attente" | "echec";
  paymentIntent?: string;
  montantCentimes: number | null;
  devise: string | null;
};

export interface Passerelle {
  nom: "stripe" | "doublure";
  creerSession(d: DemandeSession): Promise<{ id: string; url: string }>;
  lireSession(id: string): Promise<EtatSession>;
  // Sans montant : tout ce qui reste. Avec une clé : un remboursement partiel précis, rejouable sans doublon.
  rembourser(paymentIntent: string, options?: { montantCentimes?: number; cle?: string }): Promise<{ id: string }>;
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
  // Une préversion qui écrit dans la vraie base ne prend aucun paiement, même de test : la carte 4242
  // y créerait une commande « payée » sur la vraie tablette (audit de sécurité, S2).
  if (!enProduction && !baseDeTest()) {
    throw new Error("Paiement refusé : cette préversion écrit dans la vraie base (BASE_DE_TEST=1 pour un projet de test).");
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
    const montant = { montantCentimes: session.amount_total, devise: session.currency };
    if (session.payment_status === "paid") return { statut: "paye", paymentIntent, ...montant };
    if (session.status === "expired") return { statut: "echec", ...montant };
    return { statut: "en_attente", ...montant };
  },
  async rembourser(paymentIntent, options = {}) {
    const r = await s.refunds.create(
      { payment_intent: paymentIntent, ...(options.montantCentimes ? { amount: options.montantCentimes } : {}) },
      { idempotencyKey: options.cle ? `remboursement-geste-${options.cle}` : `remboursement-${paymentIntent}` },
    );
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
    return { statut: "en_attente", montantCentimes: null, devise: null };
  },
  async rembourser(paymentIntent, options = {}) {
    return { id: `re_doublure_${options.cle ?? paymentIntent}` };
  },
  async expirerSession() {},
};

export function passerelle(): Passerelle {
  const s = clientStripe();
  if (s) return passerelleStripe(s);
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error("STRIPE_SECRET_KEY manquante en production.");
  if (!baseDeTest()) throw new Error("Paiement simulé refusé : cette préversion écrit dans la vraie base (BASE_DE_TEST=1 pour un projet de test).");
  return passerelleDoublure;
}

// Le paiement en ligne est-il possible ici ? Sans lever d'erreur, pour les pages et les contrôles.
export function paiementDisponible(): boolean {
  try {
    passerelle();
    return true;
  } catch {
    return false;
  }
}

// La doublure est-elle la passerelle de ce déploiement ?
export function doublureActive(): boolean {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") return false;
  try {
    return passerelle().nom === "doublure";
  } catch {
    return false;
  }
}

// Remboursement d'un paiement simulé (commande de test déjà payée par la doublure) : aucun argent n'a
// circulé, rien à demander à Stripe ni à la passerelle du moment.
export function remboursementSimule(paymentIntent: string, cle?: string): { id: string } | null {
  return paymentIntent.startsWith("pi_doublure_") ? { id: `re_doublure_${cle ?? paymentIntent}` } : null;
}
