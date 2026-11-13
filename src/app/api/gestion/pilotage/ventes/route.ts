import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { lireDemande, type TableauVentes } from "@/lib/pilotage";
import { exigerGerant } from "@/lib/personnel/session";

// Tableau des ventes du back-office : ?periode=jour|semaine|mois&jour=AAAA-MM-JJ, ou
// ?periode=choisie&debut=…&fin=… (et &comp_debut=…&comp_fin=… pour choisir la comparaison). Un an au plus.
// &service=midi|soir : un seul service, comparé au même service de la période de comparaison.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const demande = lireDemande(new URL(requete.url).searchParams);
  if (!demande) return refus("Période invalide (un an au plus).");
  const tableau = await fonctionSql<TableauVentes>("pilotage_ventes", {
    p_debut: demande.debut,
    p_fin: demande.fin,
    p_comp_debut: demande.comparaison?.debut ?? null,
    p_comp_fin: demande.comparaison?.fin ?? null,
    p_service: demande.service ?? null,
  });
  return NextResponse.json(tableau, { headers: { "Cache-Control": "no-store" } });
}
