import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";

// Commandes plus anciennes du compte de la session, par pages de 30 (avant : date de la dernière affichée).
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  const avant = corps?.avant;
  if (typeof avant !== "string" || Number.isNaN(Date.parse(avant))) return refus("Date invalide.");
  const page = await fonctionSql<unknown>("commandes_compte", { p_compte: g.compte.id, p_avant: avant, p_limite: 30 });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
