import { NextResponse } from "next/server";
import { corpsJson, effacerCookie, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { empreinte, ipCourt, ipDe } from "@/lib/comptes/securite";
import { jetonSession } from "@/lib/comptes/session";
import { fonctionSql } from "@/lib/db/serveur";

// Déconnexion de ce navigateur, ou de tous les appareils ({ partout: true }).
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = (await corpsJson(requete)) ?? {};
  const jeton = await jetonSession();
  if (jeton) {
    await fonctionSql("deconnecter", {
      p_session_hache: empreinte("session", jeton),
      p_partout: corps.partout === true,
      p_ip_court: ipCourt(ipDe(requete)),
    });
  }
  return effacerCookie(NextResponse.json({ deconnecte: true }));
}
