import { NextResponse } from "next/server";
import { corpsJson, effacerCookie, exigerCompte, refus } from "@/lib/comptes/api";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";

// Suppression du compte (nLPD). Les commandes passées restent, détachées, pour la comptabilité.
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (corps?.confirmer !== true) return refus("Cochez la case pour confirmer.");
  await fonctionSql("supprimer_compte", { p_compte: g.compte.id, p_cle_email: empreinte("email", g.compte.email) });
  return effacerCookie(NextResponse.json({ supprime: true }));
}
