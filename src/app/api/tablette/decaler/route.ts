import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { apercuDecalage, decalerCommandes } from "@/lib/decalage";
import { exigerPersonnel } from "@/lib/personnel/session";

// « +N min sur les commandes en cours » depuis la tablette (vague 3, P0 de produit-gestion ; base et serveur de
// bo-operations, src/lib/decalage.ts). La base revérifie l'équipe (equipe_nom) et ne décale qu'une fois par clé.
// GET ?station=pizza|cuisine (facultatif) : { commandes, clients }. POST { minutes, station?, cle }.
const SANS_CACHE = { "Cache-Control": "no-store" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const apercu = await apercuDecalage(new URL(requete.url).searchParams.get("station")).catch(() => null);
  if (!apercu) return refus("Pas encore disponible.", 503);
  return NextResponse.json(apercu, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const r = await decalerCommandes({ minutes: c.minutes, station: c.station, cle: c.cle }, g.personnel);
  if (!r.ok) return refus(r.erreur);
  return NextResponse.json(r, { headers: SANS_CACHE });
}
