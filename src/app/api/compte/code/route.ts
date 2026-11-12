import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { commandeACompte, demanderCode } from "@/lib/comptes/connexion";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { emailNormalise, ipDe } from "@/lib/comptes/securite";

// Envoi d'un code de connexion, à un e-mail tapé ou à celui d'une commande (lien de suivi, case
// « créer mon compte »). Même réponse que le compte existe ou non.
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  if (!corps) return refus("Requête illisible.", 400);
  const email = corps.jeton !== undefined ? ((await commandeACompte(corps.jeton))?.email ?? null) : emailNormalise(corps.email);
  if (!email) return refus("Vérifiez l'adresse e-mail.");
  try {
    const r = await demanderCode(email, ipDe(requete));
    if (r.statut === "attente") return refus(attenteTexte(r.attente, true), 429);
    if (r.statut === "plafond") return refus("Trop de codes demandés aujourd'hui sur le site. Réessayez demain. Vous pouvez commander sans compte.", 429);
    if (r.statut === "envoi-indisponible") return refus("Préversion branchée sur la vraie base. La connexion attend le branchement des e-mails.", 503);
    if (r.statut === "adresse-preversion") {
      return refus("Préversion : utilisez une adresse qui finit par .test, par exemple jeremy@laferme.test.");
    }
    return NextResponse.json({ envoye: true, codePreversion: r.codePreversion }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`Code de connexion non envoyé : ${e instanceof Error ? e.message : e}`);
    return refus("L'e-mail ne part pas pour le moment. Réessayez dans un instant.", 502);
  }
}
