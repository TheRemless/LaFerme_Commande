import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { csvVentes, dateValide, type Vente } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";

// Export CSV des ventes encaissées pour la fiduciaire : ?debut=2026-11-01&fin=2026-11-30 (un an au plus).
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const debut = dateValide(q.get("debut"));
  const fin = dateValide(q.get("fin"));
  if (!debut || !fin || fin < debut || Date.parse(fin) - Date.parse(debut) > 366 * 86_400_000) return refus("Période invalide (un an au plus).");
  const ventes = await fonctionSql<Vente[]>("export_ventes", { p_debut: debut, p_fin: fin });
  return new NextResponse(csvVentes(ventes), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="la-ferme-ventes-${debut}-${fin}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
