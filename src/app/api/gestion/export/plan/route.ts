import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { validerPlan, type PlanComptes } from "@/lib/export-cresus";
import { exigerGerant } from "@/lib/personnel/session";

const sansCache = { "Cache-Control": "no-store" };

// Plan de comptes de l'export Crésus (gérant) : GET le lit, POST { comptes } l'enregistre et le confirme.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql<PlanComptes>("plan_comptes_cresus", {}), { headers: sansCache });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const v = validerPlan(c.comptes);
  if (!v.ok) return refus(v.erreur);
  const plan = await fonctionSql<PlanComptes>("regler_plan_comptes_cresus", { p_comptes: v.comptes, p_personnel: g.personnel.id });
  return NextResponse.json(plan, { headers: sansCache });
}
