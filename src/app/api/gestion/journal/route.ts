import { NextResponse } from "next/server";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("journal_gestion_recent", { p_limite: 200 }), { headers: { "Cache-Control": "no-store" } });
}
