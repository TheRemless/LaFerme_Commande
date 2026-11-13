import { NextResponse } from "next/server";
import { chargerAccueil } from "@/lib/accueil-gestion";
import { exigerGerant } from "@/lib/personnel/session";

// Accueil du back-office (vague 3, bo-socle) : commandes à traiter, état du restaurant, ventes du service
// contre le même service la semaine passée, alertes. Lecture seule, relue toutes les 20 secondes par l'écran.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await chargerAccueil(), { headers: { "Cache-Control": "no-store" } });
}
