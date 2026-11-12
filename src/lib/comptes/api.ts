import "server-only";
import { NextResponse } from "next/server";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { compteCourant, nomCookie, optionsCookie, type CompteSession } from "@/lib/comptes/session";

export function refus(message: string, status = 422) {
  return NextResponse.json({ erreur: message }, { status, headers: { "Cache-Control": "no-store" } });
}

// envoi : attente entre deux envois de code, sans essai faux (CM-16).
export function attenteTexte(secondes: number, envoi = false): string {
  if (envoi && secondes < 2 * 3600) {
    const duree = secondes < 60 ? `${secondes} seconde${secondes > 1 ? "s" : ""}` : `${Math.ceil(secondes / 60)} minute${Math.ceil(secondes / 60) > 1 ? "s" : ""}`;
    return `Un nouveau code pourra partir dans ${duree}.`;
  }
  if (secondes < 60) return `Trop d'essais. Réessayez dans ${secondes} seconde${secondes > 1 ? "s" : ""}.`;
  if (secondes < 2 * 3600) {
    const m = Math.ceil(secondes / 60);
    return `Trop d'essais. Réessayez dans ${m} minute${m > 1 ? "s" : ""}.`;
  }
  // Plafond du jour atteint (quinze essais faux) : jusqu'à 24 heures.
  return `Trop d'essais. Réessayez dans ${Math.ceil(secondes / 3600)} heures ou appelez-nous au 022 792 16 89.`;
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
