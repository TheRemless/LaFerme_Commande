import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { deplacerParLivreur, exigerLivreurOuChef, prendreLivraison } from "@/lib/livreur";

// Le livreur choisit ses commandes et son ordre (réponses de Jérémy du 14.11.2026).
// POST { action: "prendre", commande } → 200 { ok: true } | 409 { ok: false, message } (« Déjà prise par Marco. »)
// POST { action: "deplacer", commande, sens: -1 | 1 } → 200 { ok: true } | 409 { ok: false, message }
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function POST(requete: Request) {
  const g = await exigerLivreurOuChef(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.commande !== "string" || !/^[0-9a-f-]{36}$/.test(c.commande)) return refus("Commande inconnue.", 404);
  let r: { ok: boolean; message?: string };
  if (c.action === "prendre") r = await prendreLivraison(g.personnel, c.commande);
  else if (c.action === "deplacer" && (c.sens === -1 || c.sens === 1)) r = await deplacerParLivreur(g.personnel, c.commande, c.sens);
  else return refus("Action inconnue.");
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: SANS_CACHE });
}
