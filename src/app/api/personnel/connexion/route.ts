import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { codeValide, emailNormalise, ipDe } from "@/lib/comptes/securite";
import { verifierCodePersonnel } from "@/lib/personnel/connexion";
import { DUREE_LIVREUR_S, jetonPersonnel, nomCookiePersonnel, optionsCookiePersonnel } from "@/lib/personnel/session";

export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  const email = emailNormalise(corps?.email);
  const code = codeValide(corps?.code, 8);
  if (!email || !code) return refus("Entrez le code à 8 chiffres reçu par e-mail.");
  const r = await verifierCodePersonnel(email, code, ipDe(requete), await jetonPersonnel());
  if (r.statut === "attente") return refus(attenteTexte(r.attente), 429);
  if (r.statut === "invalide") return refus("Code incorrect ou expiré. Vérifiez le dernier e-mail reçu.", 400);
  const rep = NextResponse.json({ connecte: true }, { headers: { "Cache-Control": "no-store" } });
  rep.cookies.set(nomCookiePersonnel(), r.jeton, optionsCookiePersonnel(r.role === "livreur" ? DUREE_LIVREUR_S : undefined));
  return rep;
}
