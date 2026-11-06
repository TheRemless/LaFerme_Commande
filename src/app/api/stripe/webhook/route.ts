import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { annulerPaiement, confirmerPaiement } from "@/lib/commandes";
import { clientStripe } from "@/lib/paiement/passerelle";

// Webhook Stripe : seule source qui confirme un paiement (avec la réconciliation, qui relit Stripe).
// Signature vérifiée sur le corps brut. Chaque événement n'est appliqué qu'une fois (appliquer_paiement).
export async function POST(requete: Request) {
  const stripe = clientStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ erreur: "Webhook non configuré." }, { status: 503 });

  const signature = requete.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ erreur: "Signature absente." }, { status: 400 });
  let evenement: Stripe.Event;
  try {
    evenement = stripe.webhooks.constructEvent(await requete.text(), signature, secret);
  } catch {
    return NextResponse.json({ erreur: "Signature invalide." }, { status: 400 });
  }

  if (evenement.type.startsWith("checkout.session.")) {
    const session = evenement.data.object as Stripe.Checkout.Session;
    const commandeId = session.metadata?.commande_id ?? session.client_reference_id;
    if (!commandeId) return NextResponse.json({ recu: true });
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    switch (evenement.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        // TWINT peut finir plus tard : « completed » sans paiement attend l'événement asynchrone.
        if (session.payment_status === "paid") {
          await confirmerPaiement(commandeId, evenement.id, {
            sessionId: session.id,
            montantCentimes: session.amount_total,
            devise: session.currency,
            paymentIntent,
          });
        }
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await annulerPaiement(commandeId, evenement.id, session.id);
        break;
    }
  }
  return NextResponse.json({ recu: true });
}
