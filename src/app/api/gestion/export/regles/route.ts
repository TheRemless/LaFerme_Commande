import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { validerRegleTva, type ReglesTva } from "@/lib/export-cresus";
import { exigerGerant } from "@/lib/personnel/session";

const sansCache = { "Cache-Control": "no-store" };

// Règles de TVA d'une commande à deux taux (réglages de bo-carte, questions F3 et F4 de la fiduciaire) : GET les lit,
// POST { cle, valeur } en change une (gérant, journalisé).
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql<ReglesTva>("regles_tva", {}), { headers: sansCache });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const v = validerRegleTva(c.cle, c.valeur);
  if (!v.ok) return refus(v.erreur);
  await fonctionSql("regler_regle_tva", { p_cle: v.cle, p_valeur: v.valeur, p_personnel: g.personnel.id });
  return NextResponse.json(await fonctionSql<ReglesTva>("regles_tva", {}), { headers: sansCache });
}
