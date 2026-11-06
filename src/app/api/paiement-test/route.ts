import { NextResponse } from "next/server";
import { annulerPaiement, confirmerPaiement } from "@/lib/commandes";
import { commandeParId } from "@/lib/db/serveur";
import { passerelle } from "@/lib/paiement/passerelle";

// Doublure de Stripe pour les préversions sans compte Stripe : simule l'issue du paiement en passant
// par le même chemin que le webhook. Fermée en production et dès qu'une vraie clé Stripe est configurée.
export async function POST(requete: Request) {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production" || passerelle().nom !== "doublure") {
    return NextResponse.json({ erreur: "Introuvable." }, { status: 404 });
  }
  const corps = (await requete.json().catch(() => ({}))) as { commande?: unknown; issue?: unknown };
  if (typeof corps.commande !== "string" || !/^[0-9a-f-]{36}$/.test(corps.commande)) {
    return NextResponse.json({ erreur: "Commande inconnue." }, { status: 404 });
  }
  const c = await commandeParId(corps.commande);
  if (!c || c.stripe_session_id !== `doublure_${c.id}`) return NextResponse.json({ erreur: "Commande inconnue." }, { status: 404 });
  if (corps.issue === "paye") await confirmerPaiement(c.id, `doublure:${c.id}:paye`, `pi_doublure_${c.id}`);
  else await annulerPaiement(c.id, `doublure:${c.id}:echec`, `doublure_${c.id}`);
  return NextResponse.json({ redirection: corps.issue === "paye" ? `/suivi/${c.jeton_suivi}?retour=1` : "/commande?annule=1" });
}
