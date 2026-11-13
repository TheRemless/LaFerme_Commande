import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { csvVentes, dateValide, type Remboursement, type Vente } from "@/lib/gestion";
import { csvRecapJours, type RecapJour } from "@/lib/export-compta";
import { exigerGerant } from "@/lib/personnel/session";

// Export CSV des ventes encaissées et des remboursements faits sur la période, pour la fiduciaire : ?debut=2026-11-01&fin=2026-11-30 (un an au plus).
// &format=jours : une ligne par jour et par taux de TVA (récapitulatif, src/lib/export-compta.ts).
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const debut = dateValide(q.get("debut"));
  const fin = dateValide(q.get("fin"));
  if (!debut || !fin || fin < debut || Date.parse(fin) - Date.parse(debut) > 366 * 86_400_000) return refus("Période invalide (un an au plus).");
  if (q.get("format") === "jours") {
    const lignes = await fonctionSql<RecapJour[]>("export_recap_jours", { p_debut: debut, p_fin: fin });
    return new NextResponse(csvRecapJours(lignes), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="la-ferme-jours-${debut}-${fin}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const [ventes, remboursements] = await Promise.all([
    fonctionSql<Vente[]>("export_ventes", { p_debut: debut, p_fin: fin }),
    fonctionSql<Remboursement[]>("export_remboursements", { p_debut: debut, p_fin: fin }),
  ]);
  return new NextResponse(csvVentes(ventes, remboursements), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="la-ferme-ventes-${debut}-${fin}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
