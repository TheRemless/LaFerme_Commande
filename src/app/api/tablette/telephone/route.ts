import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { prendreCommandeTelephone } from "@/lib/commande-telephone";
import { origineSure } from "@/lib/origine";
import { exigerPersonnel } from "@/lib/personnel/session";

// Commande prise au téléphone (vague 3, bo-commandes) : toute l'équipe de la tablette (service, gérant,
// responsable), jamais un livreur. POST { cle, mode, lignes, quand, client: { prenom, nom?, telephone, email? },
// adresse?, details?, allergie? }. Les données du client passent dans le corps, jamais dans l'adresse.
export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const origine = origineSure(requete);
  if (!origine) return refus("Adresse du site inconnue.", 503);
  const r = await prendreCommandeTelephone(c, g.personnel, origine);
  return NextResponse.json(r, { status: r.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
