import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { lireDemande, type Analyses } from "@/lib/pilotage";
import { exigerGerant } from "@/lib/personnel/session";
import { lireStats } from "@/lib/planning-livreurs";

// Analyses du back-office (plats, catégories, heures, zones, clients) : mêmes paramètres que
// /api/gestion/pilotage/ventes ; la comparaison est ignorée.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const demande = lireDemande(new URL(requete.url).searchParams);
  if (!demande) return refus("Période invalide (un an au plus).");
  // Les chiffres des livreurs viennent de bo-operations (stats_livreurs, docs/livreurs.md) : repris tels quels.
  // Ils couvrent la journée entière, quel que soit le service choisi.
  const [analyses, livreurs] = await Promise.all([
    fonctionSql<Analyses>("pilotage_analyses", { p_debut: demande.debut, p_fin: demande.fin, p_service: demande.service ?? null }),
    lireStats(demande.debut, demande.fin),
  ]);
  return NextResponse.json({ ...analyses, livreurs }, { headers: { "Cache-Control": "no-store" } });
}
