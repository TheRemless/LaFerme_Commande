import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { etatImpression } from "@/lib/impression/service";
import { exigerPersonnel } from "@/lib/personnel/session";
import { fileTablette } from "@/lib/tablette";

// Détail d'une commande terminée ou refusée (vague 3, file allégée) : la file l'envoie sans ses lignes, la tablette
// les demande quand on ouvre la commande. Rare (un toucher), donc la file complète est relue ici.
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const id = new URL(requete.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return refus("Commande inconnue.", 404);
  const [commandes, impression] = await Promise.all([fileTablette(), etatImpression()]);
  const commande = commandes.find((c) => c.id === id);
  if (!commande) return refus("Commande inconnue.", 404);
  return NextResponse.json({ commande, taches: impression.taches.filter((t) => t.commande_id === id) }, { headers: { "Cache-Control": "no-store" } });
}
