import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { connexionParCodeActive, creerCodeLivreur, peutCreerCode } from "@/lib/personnel/code-livreur";
import { exigerPersonnel } from "@/lib/personnel/session";

// « Code de connexion » d'un livreur sur la tablette (vague 3, D13 point 3, construit désactivé). GET : { actif,
// autorise } pour afficher le bouton ; POST { livreur } : { code, expire_le } à montrer au livreur. Gérant ou
// responsable seulement, revérifié en base.
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const actif = await connexionParCodeActive();
  return NextResponse.json({ actif, autorise: actif && (await peutCreerCode(g.personnel)) }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.livreur !== "string") return refus("Ce livreur ne fait plus partie de l'équipe.");
  const r = await creerCodeLivreur(c.livreur, g.personnel);
  if (!r.ok) return refus(r.erreur, 403);
  return NextResponse.json(r, { headers: SANS_CACHE });
}
