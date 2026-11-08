import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { empreinte, ipCourt, ipDe } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import { jetonPersonnel, nomCookiePersonnel, optionsCookiePersonnel } from "@/lib/personnel/session";

export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const jeton = await jetonPersonnel();
  if (jeton) await fonctionSql("deconnecter_personnel", { p_session_hache: empreinte("session-personnel", jeton), p_ip_court: ipCourt(ipDe(requete)) });
  const rep = NextResponse.json({ deconnecte: true });
  rep.cookies.set(nomCookiePersonnel(), "", optionsCookiePersonnel(0));
  return rep;
}
