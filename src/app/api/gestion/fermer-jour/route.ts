import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fermerServiceDuJour } from "@/lib/fermer-service";
import { exigerDroit } from "@/lib/personnel/session";

// Fermer le service du jour (vague 3, bo-operations) : gérant, ou responsable de service quand le rôle est activé
// (droit fermer_service, revérifié en base). POST { quoi: "midi" | "soir" | "journee", motif }. Aujourd'hui seulement.
export async function POST(requete: Request) {
  const g = await exigerDroit(requete, "fermer_service");
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const r = await fermerServiceDuJour(g.personnel, c.quoi, c.motif);
  if (!r.ok) return refus(r.erreur, r.code ?? 422);
  return NextResponse.json({ enregistre: true, commandes: r.commandes }, { headers: { "Cache-Control": "no-store" } });
}
