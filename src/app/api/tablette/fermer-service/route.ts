import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { fermerServiceDuJour } from "@/lib/fermer-service";
import { exigerDroit, exigerPersonnel } from "@/lib/personnel/session";

// Fermer le service du jour depuis la tablette (vague 3, D1 ; contrat de bo-operations, src/lib/fermer-service.ts) :
// le gérant, ou le responsable de service quand role_responsable_actif est vrai. Aujourd'hui seulement : la date vient
// de la base, jamais de la tablette. GET : { autorise } pour montrer le bloc. POST { quoi, motif } →
// { ok: true, commandes: number[] } (numéros déjà pris pour ce moment) | 400, 403 { erreur }.
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const autorise = await fonctionSql<boolean>("droit_personnel", { p_personnel: g.personnel.id, p_action: "fermer_service" });
  return NextResponse.json({ autorise }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerDroit(requete, "fermer_service");
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const r = await fermerServiceDuJour(g.personnel, c.quoi, c.motif);
  if (!r.ok) return refus(r.erreur, r.code ?? 400);
  return NextResponse.json(r, { headers: SANS_CACHE });
}
