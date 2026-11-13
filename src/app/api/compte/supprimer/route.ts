import { NextResponse } from "next/server";
import { corpsJson, effacerCookie, exigerCompte, refus } from "@/lib/comptes/api";
import { supprimerCompte } from "@/lib/comptes/donnees";

// Suppression du compte (nLPD), notes du restaurant comprises. Les commandes passées restent, détachées,
// pour la comptabilité.
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (corps?.confirmer !== true) return refus("Cochez la case pour confirmer.");
  await supprimerCompte(g.compte);
  return effacerCookie(NextResponse.json({ supprime: true }));
}
