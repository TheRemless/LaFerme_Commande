import "server-only";
import { NextResponse } from "next/server";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { compteCourant, nomCookie, optionsCookie, type CompteSession } from "@/lib/comptes/session";

export function refus(message: string, status = 422) {
  return NextResponse.json({ erreur: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function attenteTexte(secondes: number): string {
  if (secondes < 60) return `Trop d'essais. Réessayez dans ${secondes} seconde${secondes > 1 ? "s" : ""}.`;
  const m = Math.ceil(secondes / 60);
  return `Trop d'essais. Réessayez dans ${m} minute${m > 1 ? "s" : ""}.`;
}

export async function corpsJson(requete: Request): Promise<Record<string, unknown> | null> {
  try {
    const c = await requete.json();
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Route qui change un état pour le compte de la session : même site exigé, puis session valable.
export async function exigerCompte(requete: Request): Promise<{ compte: CompteSession } | { reponse: NextResponse }> {
  if (!requeteDuSite(requete)) return { reponse: refus("Requête refusée.", 403) };
  const compte = await compteCourant();
  if (!compte) return { reponse: refus("Session terminée. Reconnectez-vous.", 401) };
  return { compte };
}

export function effacerCookie(rep: NextResponse): NextResponse {
  rep.cookies.set(nomCookie(), "", optionsCookie(0));
  return rep;
}
