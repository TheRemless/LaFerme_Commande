import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { ipCourt, ipDe } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";

// Retirer une adresse enregistrée. La base ne touche qu'aux adresses du compte de la session.
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  const id = corps?.supprimer;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return refus("Adresse inconnue.", 404);
  await fonctionSql("supprimer_adresse", { p_compte: g.compte.id, p_adresse: id, p_ip_court: ipCourt(ipDe(requete)) });
  return NextResponse.json({ supprimee: true });
}
