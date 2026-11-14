import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { encaisserComplement } from "@/lib/difference";
import { exigerPersonnel } from "@/lib/personnel/session";

// Complément d'une commande modifiée encaissé au comptoir ou au retour du livreur (vague 3, bo-commandes) : l'équipe
// de la tablette. POST { complement, moyen: "especes" | "carte" }.
export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.complement !== "string" || !/^[0-9a-f-]{36}$/.test(c.complement)) return refus("Complément inconnu.", 404);
  const r = await encaisserComplement(c.complement, c.moyen, g.personnel);
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
