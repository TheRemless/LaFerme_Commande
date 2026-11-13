import { NextResponse } from "next/server";
import { fonctionSql } from "@/lib/db/serveur";
import type { RemboursementASuivre } from "@/lib/export-compta";
import { exigerGerant } from "@/lib/personnel/session";

// Remboursements à suivre : en échec, ou pas confirmés par Stripe depuis plus de 24 heures.
export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const liste = await fonctionSql<RemboursementASuivre[]>("remboursements_a_suivre", { p_heures: 24 });
  return NextResponse.json(liste, { headers: { "Cache-Control": "no-store" } });
}
