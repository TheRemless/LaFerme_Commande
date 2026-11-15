import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { ajusterCagnotte, cagnotteClient, messageAjustement } from "@/lib/cagnotte";
import { emailClient } from "@/lib/gestion-clients";
import { exigerDroit, exigerGerant } from "@/lib/personnel/session";

// Cagnotte d'un client au back-office (vague 3, client-compte). Tout en POST : l'e-mail n'est jamais dans une adresse.
// { action: "fiche", email } : solde et mouvements (comme la fiche du client : droit voir_commandes).
// { action: "ajuster", email, montant_centimes, motif } : gérant seulement, la base revérifie (gerant_nom).
export async function POST(requete: Request) {
  const c = await corpsJson(requete);
  const g = c?.action === "fiche" ? await exigerDroit(requete, "voir_commandes") : await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const email = emailClient(c?.email);
  if (!email) return refus("Client introuvable.", 404);
  const sansCache = { headers: { "Cache-Control": "no-store" } };

  if (c?.action === "fiche") {
    return NextResponse.json(await cagnotteClient(email), sansCache);
  }
  if (c?.action === "ajuster") {
    const montant = c.montant_centimes;
    if (typeof montant !== "number" || !Number.isInteger(montant)) return refus("Montant de CHF 0.01 à CHF 100, en plus ou en moins.");
    const motif = typeof c.motif === "string" ? c.motif : "";
    try {
      return NextResponse.json({ solde_centimes: await ajusterCagnotte(email, montant, motif, g.personnel.id) }, sansCache);
    } catch (e) {
      const m = messageAjustement(e);
      if (m) return refus(m, 422);
      throw e;
    }
  }
  return refus("Action inconnue.", 400);
}
