import { NextResponse } from "next/server";
import { confirmerComplement, expirerComplement } from "@/lib/difference";
import type Stripe from "stripe";
import { annulerPaiement, appliquerEtatRemboursement, confirmerPaiement } from "@/lib/commandes";
import { clientStripe, etatRemboursement } from "@/lib/paiement/passerelle";

// Webhook Stripe : seule source qui confirme un paiement (avec la réconciliation, qui relit Stripe).
// Signature vérifiée sur le corps brut. Chaque événement n'est appliqué qu'une fois (appliquer_paiement).
export async function POST(requete: Request) {
  let stripe: ReturnType<typeof clientStripe>;
  try {
    stripe = clientStripe();
  } catch {
    // Clé refusée ici (préversion sur la vraie base, clé live hors production) : rien n'est appliqué.
    return NextResponse.json({ erreur: "Webhook non configuré." }, { status: 503 });
  }
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
    // Complément d'une commande modifiée (vague 3, bo-commandes) : jamais le paiement de la commande elle-même.
    const modification = session.metadata?.type === "complement" ? session.metadata.modification_id : undefined;
    if (session.metadata?.type === "complement") {
      if (!modification || !/^[0-9a-f-]{36}$/.test(modification)) return NextResponse.json({ recu: true });
      if ((evenement.type === "checkout.session.completed" || evenement.type === "checkout.session.async_payment_succeeded") && session.payment_status === "paid") {
        await confirmerComplement(modification, evenement.id, { sessionId: session.id, montantCentimes: session.amount_total, devise: session.currency, paymentIntent: paymentIntent ?? null });
      } else if (evenement.type === "checkout.session.async_payment_failed" || evenement.type === "checkout.session.expired") {
        await expirerComplement(modification, session.id);
      }
      return NextResponse.json({ recu: true });
    }
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
  // Remboursement qui finit plus tard (TWINT) : seul « succeeded » le rend fait, « failed » alerte le restaurant
  // (audit de sécurité 2, S2-03). Rejoué ou reçu dans le désordre : la base ne change qu'une ligne en cours.
  // Réponse perdue à la création : la ligne se rattache par les metadata au changement d'état suivant. Pas
  // refund.created : il peut arriver avant la réponse de Stripe au serveur, qui n'enverrait alors pas l'e-mail
  // au client. Un remboursement réussi tout de suite se reprend à la relance (retrouverRemboursement).
  if (evenement.type === "charge.refund.updated" || evenement.type === "refund.updated") {
    const refund = evenement.data.object as Stripe.Refund;
    await appliquerEtatRemboursement(refund.id, etatRemboursement(refund.status), refund.failure_reason ?? null, refund.metadata?.remboursement_id ?? null);
  }
  return NextResponse.json({ recu: true });
}
