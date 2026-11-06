import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { commandeACompte, verifierCode } from "@/lib/comptes/connexion";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { codeValide, emailNormalise, ipDe } from "@/lib/comptes/securite";
import { jetonSession, nomCookie, optionsCookie } from "@/lib/comptes/session";

// Vérification du code. Bon : nouvelle session dans un cookie neuf, l'ancienne est fermée.
// Avec le jeton d'une commande, l'e-mail est celui de la commande, qui est rattachée au compte.
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  if (!corps) return refus("Requête illisible.", 400);
  const code = codeValide(corps.code);
  const commande = corps.jeton !== undefined ? await commandeACompte(corps.jeton) : null;
  const email = commande ? commande.email : corps.jeton !== undefined ? null : emailNormalise(corps.email);
  const jetonCommande = commande?.jeton ?? null;
  if (!email || !code) return refus("Entrez le code à 6 chiffres reçu par e-mail.");
  const r = await verifierCode(email, code, ipDe(requete), await jetonSession(), jetonCommande);
  if (r.statut === "attente") return refus(attenteTexte(r.attente), 429);
  if (r.statut === "invalide") return refus("Code incorrect ou expiré. Vérifiez le dernier e-mail reçu.", 400);
  const rep = NextResponse.json({ connecte: true }, { headers: { "Cache-Control": "no-store" } });
  rep.cookies.set(nomCookie(), r.jeton, optionsCookie());
  return rep;
}
