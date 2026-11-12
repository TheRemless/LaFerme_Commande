import { NextResponse } from "next/server";
import { attenteTexte, corpsJson, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { emailNormalise, ipDe } from "@/lib/comptes/securite";
import { demanderCodePersonnel } from "@/lib/personnel/connexion";

// Code de connexion de la tablette. Même réponse que l'adresse fasse partie de l'équipe ou non.
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = await corpsJson(requete);
  const email = emailNormalise(corps?.email);
  if (!email) return refus("Vérifiez l'adresse e-mail.");
  try {
    const r = await demanderCodePersonnel(email, ipDe(requete));
    if (r.statut === "attente") return refus(attenteTexte(r.attente), 429);
    if (r.statut === "envoi-indisponible") return refus("Préversion branchée sur la vraie base. La connexion attend l'envoi des e-mails (Resend).", 503);
    if (r.statut === "adresse-preversion") return refus("Préversion : utilisez une adresse qui finit par .test, par exemple equipe@laferme.test.");
    return NextResponse.json({ envoye: true, codePreversion: r.codePreversion }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`Code du personnel non envoyé : ${e instanceof Error ? e.message : e}`);
    return refus("L'e-mail ne part pas pour le moment. Réessayez dans un instant.", 502);
  }
}
