import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { fonctionSql } from "@/lib/db/serveur";
import { empreinte } from "@/lib/comptes/securite";

// Session du compte : un jeton aléatoire de 32 octets dans un cookie HttpOnly, Secure, SameSite=Lax.
// En base, seulement son empreinte. Valable 30 jours, révocable (déconnexion, « tous mes appareils »).

export type CompteSession = { id: string; email: string; prenom: string; nom: string; telephone: string };

const DUREE_S = 30 * 24 * 60 * 60;

// Le préfixe __Host- interdit à un sous-domaine de poser ou d'écraser le cookie. Il exige https :
// sur le poste local (http://localhost), un nom simple.
export function nomCookie(): string {
  return process.env.CONTEXTE_DEPLOIEMENT === "local" ? "laferme-session" : "__Host-laferme-session";
}

export function optionsCookie(maxAge = DUREE_S) {
  return {
    httpOnly: true,
    secure: process.env.CONTEXTE_DEPLOIEMENT !== "local",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function jetonSession(): Promise<string | null> {
  const v = (await cookies()).get(nomCookie())?.value;
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}

// Compte de la requête en cours, lu une fois par rendu.
export const compteCourant = cache(async (): Promise<CompteSession | null> => {
  const jeton = await jetonSession();
  if (!jeton) return null;
  try {
    return await fonctionSql<CompteSession | null>("compte_de_session", { p_session_hache: empreinte("session", jeton) });
  } catch (e) {
    // Base injoignable ou préversion sans clé : on continue en invité plutôt que de casser la page.
    console.error(`Session illisible : ${e instanceof Error ? e.message : e}`);
    return null;
  }
});
