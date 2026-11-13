import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { codeValide } from "@/lib/comptes/securite";
import { utiliserCodeLivreur } from "@/lib/personnel/code-livreur";
import { DUREE_LIVREUR_S, nomCookiePersonnel, optionsCookiePersonnel } from "@/lib/personnel/session";

// Le livreur tape le code affiché sur la tablette (vague 3, D13 point 3, construit désactivé). Même frein par
// connexion que la connexion de l'équipe ; cookie de livreur de 12 heures.
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  const code = codeValide(corps?.code, 8);
  if (!code) return refus("Entrez les 8 chiffres affichés sur la tablette.");
  const r = await utiliserCodeLivreur(code, requete);
  if (r.statut === "desactive") return refus("La connexion par code n'est pas ouverte. Demandez un code par e-mail.", 403);
  if (r.statut === "attente") return refus(attenteTexte(r.attente), 429);
  if (r.statut !== "ok") return refus("Code incorrect ou expiré. Demandez-en un nouveau au restaurant.", 400);
  const rep = NextResponse.json({ connecte: true }, { headers: { "Cache-Control": "no-store" } });
  rep.cookies.set(nomCookiePersonnel(), r.jeton, optionsCookiePersonnel(DUREE_LIVREUR_S));
  return rep;
}
