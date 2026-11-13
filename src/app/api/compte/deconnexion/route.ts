import { NextResponse } from "next/server";
import { corpsJson, effacerCookie, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { empreinte, ipCourt, ipDe } from "@/lib/comptes/securite";
import { compteCourant, jetonSession } from "@/lib/comptes/session";
import { fonctionSql } from "@/lib/db/serveur";

// Déconnexion de ce navigateur, de tous les appareils ({ partout: true }) ou d'un seul autre ({ appareil: id }).
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const corps = (await corpsJson(requete)) ?? {};
  // Un seul autre appareil ({ appareil: id }) : seulement une session du compte de ce navigateur.
  if (corps.appareil !== undefined) {
    const compte = await compteCourant();
    if (!compte) return refus("Session terminée. Reconnectez-vous.", 401);
    if (typeof corps.appareil !== "string" || !/^[0-9a-f-]{36}$/.test(corps.appareil)) return refus("Appareil inconnu.", 404);
    const ok = await fonctionSql<boolean>("deconnecter_appareil", { p_compte: compte.id, p_session: corps.appareil, p_ip_court: ipCourt(ipDe(requete)) });
    return ok ? NextResponse.json({ deconnecte: true }) : refus("Appareil inconnu.", 404);
  }
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
