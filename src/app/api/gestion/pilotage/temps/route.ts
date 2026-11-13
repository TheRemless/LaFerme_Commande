import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { lireDemande, type TempsReels } from "@/lib/pilotage";
import { exigerGerant } from "@/lib/personnel/session";

// Temps réels contre temps promis (pilotage_temps) : mêmes paramètres que /api/gestion/pilotage/ventes, sans comparaison.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const demande = lireDemande(new URL(requete.url).searchParams);
  if (!demande) return refus("Période invalide (un an au plus).");
  const temps = await fonctionSql<TempsReels>("pilotage_temps", { p_debut: demande.debut, p_fin: demande.fin, p_service: demande.service ?? null });
  return NextResponse.json(temps, { headers: { "Cache-Control": "no-store" } });
}
