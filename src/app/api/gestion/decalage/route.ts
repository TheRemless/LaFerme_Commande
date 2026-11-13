import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { apercuDecalage, decalerCommandes } from "@/lib/decalage";
import { exigerGerant } from "@/lib/personnel/session";

// Décaler les commandes en cours, côté back-office (gérant). La tablette a son geste sur les mêmes fonctions
// (src/lib/decalage.ts). GET ?poste=pizza|cuisine : aperçu (commandes touchées, clients prévenus).
// POST { minutes, poste?, cle } : le geste ; la même cle ne décale qu'une fois.
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const poste = new URL(requete.url).searchParams.get("poste");
  return NextResponse.json(await apercuDecalage(poste), { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const r = await decalerCommandes({ minutes: c.minutes, station: c.poste ?? null, cle: c.cle }, g.personnel);
  if (!r.ok) return refus(r.erreur);
  return NextResponse.json({ enregistre: true, ...r }, { headers: SANS_CACHE });
}
