import { NextResponse } from "next/server";
import { annulerPaiement, appliquerEtatRemboursement, confirmerPaiement } from "@/lib/commandes";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { confirmerComplement, expirerComplement } from "@/lib/difference";
import { doublureActive } from "@/lib/paiement/passerelle";

// Doublure de Stripe pour les préversions sans compte Stripe : simule l'issue du paiement en passant
// par le même chemin que le webhook. Fermée en production, dès qu'une vraie clé Stripe est configurée et
// sur une préversion qui écrit dans la vraie base.
export async function POST(requete: Request) {
  if (!doublureActive()) {
    return NextResponse.json({ erreur: "Introuvable." }, { status: 404 });
  }
  const corps = (await requete.json().catch(() => ({}))) as { commande?: unknown; issue?: unknown; remboursement?: unknown; complement?: unknown };
  // Complément d'une commande modifiée (vague 3, bo-commandes), par le même chemin que le webhook.
  if (corps.complement !== undefined) {
    if (typeof corps.complement !== "string" || !/^[0-9a-f-]{36}$/.test(corps.complement)) return NextResponse.json({ erreur: "Complément inconnu." }, { status: 404 });
    const m = await fonctionSql<{ difference_centimes: number; jeton_suivi: string } | null>("complement_doublure", { p_modification: corps.complement });
    if (!m) return NextResponse.json({ erreur: "Complément inconnu." }, { status: 404 });
    const session = `doublure_complement_${corps.complement}`;
    if (corps.issue === "paye") {
      await confirmerComplement(corps.complement, `doublure:complement:${corps.complement}:paye`, { sessionId: session, montantCentimes: m.difference_centimes, devise: "chf", paymentIntent: `pi_doublure_complement_${corps.complement}` });
    } else await expirerComplement(corps.complement, session);
    return NextResponse.json({ redirection: `/suivi/${m.jeton_suivi}` });
  }
  // Fin d'un remboursement de la doublure joué « en attente » (DOUBLURE_REMBOURSEMENT=pending), par le même
  // chemin que le webhook charge.refund.updated (audit de sécurité 2, S2-03).
  if (corps.remboursement !== undefined) {
    if (typeof corps.remboursement !== "string" || !/^re_doublure_[A-Za-z0-9_-]{1,100}$/.test(corps.remboursement) || (corps.issue !== "fait" && corps.issue !== "echec")) {
      return NextResponse.json({ erreur: "Remboursement inconnu." }, { status: 404 });
    }
    const change = await appliquerEtatRemboursement(corps.remboursement, corps.issue === "fait" ? "succeeded" : "failed", corps.issue === "fait" ? null : "doublure");
    return NextResponse.json({ change });
  }
  if (typeof corps.commande !== "string" || !/^[0-9a-f-]{36}$/.test(corps.commande)) {
    return NextResponse.json({ erreur: "Commande inconnue." }, { status: 404 });
  }
  const c = await commandeParId(corps.commande);
  if (!c || c.stripe_session_id !== `doublure_${c.id}`) return NextResponse.json({ erreur: "Commande inconnue." }, { status: 404 });
  if (corps.issue === "paye") {
    await confirmerPaiement(c.id, `doublure:${c.id}:paye`, {
      sessionId: `doublure_${c.id}`,
      montantCentimes: c.total_centimes,
      devise: "chf",
      paymentIntent: `pi_doublure_${c.id}`,
    });
  }
  else await annulerPaiement(c.id, `doublure:${c.id}:echec`, `doublure_${c.id}`);
  return NextResponse.json({ redirection: corps.issue === "paye" ? `/suivi/${c.jeton_suivi}?retour=1` : "/commande?annule=1" });
}
