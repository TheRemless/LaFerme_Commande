import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { ticketsCommande } from "@/lib/impression/service";
import { exigerPersonnel } from "@/lib/personnel/session";

// Derniers tickets d'une commande, pour l'affichage de secours sur la tablette (à la demande).
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const id = new URL(requete.url).searchParams.get("commande");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return refus("Commande inconnue.", 404);
  return NextResponse.json(await ticketsCommande(id), { headers: { "Cache-Control": "no-store" } });
}
