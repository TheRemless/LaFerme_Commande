import { NextResponse } from "next/server";
import { chargerMiseEnRoute } from "@/lib/mise-en-route";
import { exigerGerant } from "@/lib/personnel/session";

// Mise en route (vague 3, bo-socle) : les étapes du lancement, cochées d'après l'état réel. Gérant seulement.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await chargerMiseEnRoute(g.personnel), { headers: { "Cache-Control": "no-store" } });
}
