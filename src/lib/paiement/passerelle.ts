import "server-only";
import Stripe from "stripe";
import { baseDeTest } from "@/lib/environnement";
import { fonctionSql } from "@/lib/db/serveur";

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
  // Paiement d'un complément (commande modifiée, vague 3, bo-commandes) : métadonnées lues par le webhook pour le
  // distinguer du paiement de la commande, référence et page de la doublure à part. Absents : une commande.
  metadata?: Record<string, string>;
  reference?: string;
  cheminDoublure?: string;
  description?: string;
};

export type EtatSession = {
  statut: "paye" | "en_attente" | "echec";
  paymentIntent?: string;
  montantCentimes: number | null;
  devise: string | null;
};

// État d'un remboursement chez Stripe. Seul « succeeded » veut dire que l'argent est rendu ; « pending » et
// « requires_action » attendent l'événement charge.refund.updated (audit de sécurité 2, S2-03).
export type EtatRemboursement = "succeeded" | "pending" | "requires_action" | "failed" | "canceled";
export type Remboursement = { id: string; statut: EtatRemboursement };

const ETATS_REMBOURSEMENT: readonly string[] = ["succeeded", "pending", "requires_action", "failed", "canceled"];
// Un état inconnu de Stripe (nouvelle valeur) se traite comme « pending » : rien n'est tenu pour rendu.
export function etatRemboursement(v: unknown): EtatRemboursement {
  return typeof v === "string" && ETATS_REMBOURSEMENT.includes(v) ? (v as EtatRemboursement) : "pending";
}

// Doublure, hors production : DOUBLURE_REMBOURSEMENT=pending joue un remboursement en attente, que
// /api/paiement-test termine ensuite (« fait » ou « échec ») comme le ferait le webhook.
function etatDoublure(): EtatRemboursement {
  return process.env.CONTEXTE_DEPLOIEMENT !== "production" && process.env.DOUBLURE_REMBOURSEMENT === "pending" ? "pending" : "succeeded";
}

export interface Passerelle {
  nom: "stripe" | "doublure";
  creerSession(d: DemandeSession): Promise<{ id: string; url: string }>;
  lireSession(id: string): Promise<EtatSession>;
  // Sans montant : tout ce qui reste. Avec une clé : un remboursement partiel précis, rejouable sans doublon.
  // remboursementId (notre ligne remboursements) part dans les metadata de Stripe : on la retrouve même si
  // la réponse de Stripe s'est perdue.
  rembourser(paymentIntent: string, options?: { montantCentimes?: number; cle?: string; remboursementId?: string }): Promise<Remboursement>;
  // Le remboursement déjà créé chez Stripe pour cette ligne, s'il existe. Stripe oublie ses clés
  // d'idempotence au bout de 24 heures : une relance plus tardive en créerait un second.
  retrouverRemboursement?(paymentIntent: string, remboursementId: string): Promise<Remboursement | null>;
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
        customer_email: d.email || undefined,
        client_reference_id: d.commandeId,
        metadata: { commande_id: d.commandeId, ...d.metadata },
        payment_intent_data: { metadata: { commande_id: d.commandeId, ...d.metadata }, description: d.description ?? `La Ferme, commande ${d.numero}` },
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
      {
        payment_intent: paymentIntent,
        ...(options.montantCentimes ? { amount: options.montantCentimes } : {}),
        ...(options.remboursementId ? { metadata: { remboursement_id: options.remboursementId } } : {}),
      },
      { idempotencyKey: options.cle ? `remboursement-geste-${options.cle}` : `remboursement-${paymentIntent}` },
    );
    return { id: r.id, statut: etatRemboursement(r.status) };
  },
  async retrouverRemboursement(paymentIntent, remboursementId) {
    for await (const r of s.refunds.list({ payment_intent: paymentIntent, limit: 100 })) {
      if (r.metadata?.remboursement_id === remboursementId) return { id: r.id, statut: etatRemboursement(r.status) };
    }
    return null;
  },
  async expirerSession(id) {
    const session = await s.checkout.sessions.retrieve(id);
    if (session.status === "open") await s.checkout.sessions.expire(id);
  },
});

const passerelleDoublure: Passerelle = {
  nom: "doublure",
  async creerSession(d) {
    const id = `doublure_${d.reference ?? d.commandeId}`;
    return { id, url: `${d.origine}${d.cheminDoublure ?? `/paiement-test/${d.commandeId}`}` };
  },
  // L'état vit dans la base (événements appliqués par la page de test) : rien à relire ailleurs.
  async lireSession() {
    return { statut: "en_attente", montantCentimes: null, devise: null };
  },
  async rembourser(paymentIntent, options = {}) {
    return rembourserDoublure(paymentIntent, options);
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

// Paiement simulé (commande de test déjà payée par la doublure) : aucun argent n'a circulé, rien à demander à
// Stripe ni à la passerelle du moment.
export const paiementSimule = (paymentIntent: string) => paymentIntent.startsWith("pi_doublure_");

export async function remboursementSimule(paymentIntent: string, options: { montantCentimes?: number; cle?: string } = {}): Promise<Remboursement | null> {
  return paiementSimule(paymentIntent) ? rembourserDoublure(paymentIntent, options) : null;
}

// La doublure refuse comme Stripe ce qui dépasse ce qui reste d'un paiement (charge_already_refunded,
// amount_too_large), pour que les tests voient ces cas (relecture de qualite sur #257). Le compte vit en base
// (rembourser_doublure) ; une même clé rend le même remboursement.
async function rembourserDoublure(paymentIntent: string, options: { montantCentimes?: number; cle?: string }): Promise<Remboursement> {
  const cle = options.cle ?? paymentIntent;
  const statut = etatDoublure();
  try {
    await fonctionSql("rembourser_doublure", { p_payment_intent: paymentIntent, p_montant: options.montantCentimes ?? null, p_cle: cle });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = ["charge_already_refunded", "amount_too_large"].find((c) => m.includes(c));
    if (!code) throw e;
    throw Object.assign(new Error(`Doublure de Stripe : ${code} (${paymentIntent})`), { type: "StripeInvalidRequestError", code });
  }
  return { id: `re_doublure_${cle}`, statut };
}
