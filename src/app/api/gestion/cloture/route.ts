import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { csvCloture, montantCompte, type Cloture, type ClotureJour } from "@/lib/cloture";
import { fonctionSql } from "@/lib/db/serveur";
import { dateValide } from "@/lib/gestion";
import { jourDeService } from "@/lib/pilotage";
import { exigerGerant } from "@/lib/personnel/session";

const sansCache = { "Cache-Control": "no-store" };

// Clôture du jour : GET ?jour=AAAA-MM-JJ (par défaut le jour de service en cours), &format=csv pour le fichier.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const jour = q.has("jour") ? dateValide(q.get("jour")) : jourDeService();
  if (!jour) return refus("Jour invalide.");
  const c = await fonctionSql<ClotureJour>("cloture_jour", { p_jour: jour });
  if (q.get("format") === "csv") {
    return new NextResponse(csvCloture(c), {
      headers: {
        ...sansCache,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="la-ferme-cloture-${jour}.csv"`,
      },
    });
  }
  return NextResponse.json(c, { headers: sansCache });
}

const ERREURS: Record<string, string> = {
  jour_invalide: "On ne clôture qu'un jour passé ou le jour en cours.",
  montant_invalide: "Montant compté illisible.",
  note_trop_longue: "Note trop longue (300 caractères au plus).",
};

// Clôturer : { jour, especes, carte, note }. Montants en francs, vides si pas comptés.
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const jour = dateValide(c.jour);
  const especes = montantCompte(c.especes);
  const carte = montantCompte(c.carte);
  if (!jour) return refus("Jour invalide.");
  if (especes === undefined || carte === undefined) return refus(ERREURS.montant_invalide);
  if (c.note !== undefined && c.note !== null && typeof c.note !== "string") return refus("Note illisible.");
  try {
    const cloture = await fonctionSql<Cloture>("cloturer_jour", {
      p_jour: jour,
      p_especes: especes,
      p_carte: carte,
      p_note: typeof c.note === "string" ? c.note : "",
      p_personnel: g.personnel.id,
    });
    return NextResponse.json(cloture, { headers: sansCache });
  } catch (e) {
    const code = Object.keys(ERREURS).find((k) => e instanceof Error && e.message.includes(k));
    if (code) return refus(ERREURS[code]);
    throw e;
  }
}
