import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { reglerRappelCagnotte } from "@/lib/cagnotte";

// Rappel avant l'expiration de la cagnotte (vague 3) : le client le coupe ou le remet. Rien d'autre ici, le solde
// se lit sur la page du compte avec la session.
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (typeof corps?.rappel !== "boolean") return refus("Requête illisible.", 400);
  return NextResponse.json({ rappel: await reglerRappelCagnotte(g.compte.id, corps.rappel) });
}
