import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { encaisserComplement } from "@/lib/difference";
import { exigerLivreurOuChef } from "@/lib/livreur";

// Complément d'une commande modifiée encaissé à la porte (vague 3, bo-commandes) : le livreur de la commande, ou le
// gérant ou le responsable qui livre. La base revérifie que la livraison est bien la sienne. POST { complement, moyen }.
export async function POST(requete: Request) {
  const g = await exigerLivreurOuChef(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.complement !== "string" || !/^[0-9a-f-]{36}$/.test(c.complement)) return refus("Complément inconnu.", 404);
  const r = await encaisserComplement(c.complement, c.moyen, g.personnel);
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
