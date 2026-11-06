import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { demanderCode } from "@/lib/comptes/connexion";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { emailNormalise, ipDe } from "@/lib/comptes/securite";
import { commandeParJeton } from "@/lib/db/serveur";

// Envoi d'un code de connexion, à un e-mail tapé ou à celui d'une commande (lien de suivi, case
// « créer mon compte »). Même réponse que le compte existe ou non.
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  if (!corps) return refus("Requête illisible.", 400);
  let email = emailNormalise(corps.email);
  if (!email && typeof corps.jeton === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(corps.jeton)) {
    const c = await commandeParJeton(corps.jeton);
    if (c && !c.compte_id) email = c.client_email;
  }
  if (!email) return refus("Vérifiez l'adresse e-mail.");
  try {
    const r = await demanderCode(email, ipDe(requete));
    if (r.statut === "attente") return refus(attenteTexte(r.attente), 429);
    if (r.statut === "adresse-preversion") {
      return refus("Préversion : utilisez une adresse qui finit par .test, par exemple jeremy@laferme.test.");
    }
    return NextResponse.json({ envoye: true, codePreversion: r.codePreversion }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`Code de connexion non envoyé : ${e instanceof Error ? e.message : e}`);
    return refus("L'e-mail ne part pas pour le moment. Réessayez dans un instant.", 502);
  }
}
