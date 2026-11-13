import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { lireDemande, type Analyses } from "@/lib/pilotage";
import { exigerGerant } from "@/lib/personnel/session";

// Analyses du back-office (plats, catégories, heures, zones, clients) : mêmes paramètres que
// /api/gestion/pilotage/ventes ; la comparaison est ignorée.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const demande = lireDemande(new URL(requete.url).searchParams);
  if (!demande) return refus("Période invalide (un an au plus).");
  const analyses = await fonctionSql<Analyses>("pilotage_analyses", {
    p_debut: demande.debut,
    p_fin: demande.fin,
    p_service: demande.service ?? null,
  });
  return NextResponse.json(analyses, { headers: { "Cache-Control": "no-store" } });
}
