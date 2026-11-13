import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { ipCourt, ipDe } from "@/lib/comptes/securite";
import { compteCourant } from "@/lib/comptes/session";
import { exporterCompte } from "@/lib/comptes/donnees";

// Export de toutes les données du compte en JSON (nLPD, droit d'accès), notes du restaurant comprises. Lecture seule.
export async function GET(requete: Request) {
  const compte = await compteCourant();
  if (!compte) return refus("Session terminée. Reconnectez-vous.", 401);
  const donnees = await exporterCompte(compte, ipCourt(ipDe(requete)));
  const jour = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(donnees, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="la-ferme-mes-donnees-${jour}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
