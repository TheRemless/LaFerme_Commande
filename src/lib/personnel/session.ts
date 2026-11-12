import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { NextResponse } from "next/server";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";

// Session du personnel, à part de celle des clients : autre cookie, autres empreintes, autre table.
// SameSite=Strict : la tablette n'arrive jamais sur le site par un lien venu d'ailleurs. 60 jours.

export type Role = "service" | "gerant" | "livreur";
export type Personnel = { id: string; email: string; nom: string; role: Role };

// La tablette et ses routes : service et gérant. Un livreur n'y entre pas (il ne voit que ses livraisons,
// sur /livreur) : il faut le demander explicitement avec roles.
const ROLES_TABLETTE: readonly Role[] = ["service", "gerant"];

const DUREE_S = 60 * 24 * 60 * 60;

export function nomCookiePersonnel(): string {
  return process.env.CONTEXTE_DEPLOIEMENT === "local" ? "laferme-personnel" : "__Host-laferme-personnel";
}

export function optionsCookiePersonnel(maxAge = DUREE_S) {
  return { httpOnly: true, secure: process.env.CONTEXTE_DEPLOIEMENT !== "local", sameSite: "strict" as const, path: "/", maxAge };
}

export async function jetonPersonnel(): Promise<string | null> {
  const v = (await cookies()).get(nomCookiePersonnel())?.value;
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}

export const personnelCourant = cache(async (): Promise<Personnel | null> => {
  const jeton = await jetonPersonnel();
  if (!jeton) return null;
  try {
    return await fonctionSql<Personnel | null>("personnel_de_session", { p_session_hache: empreinte("session-personnel", jeton) });
  } catch (e) {
    console.error(`Session du personnel illisible : ${e instanceof Error ? e.message : e}`);
    return null;
  }
});

function refus(message: string, status: number) {
  return NextResponse.json({ erreur: message }, { status, headers: { "Cache-Control": "no-store" } });
}

// Route de la tablette : requête du site (pour un changement d'état) et membre du personnel connecté,
// avec un rôle de la tablette (service ou gérant) sauf si roles dit autre chose.
export async function exigerPersonnel(
  requete: Request,
  { lecture = false, roles = ROLES_TABLETTE }: { lecture?: boolean; roles?: readonly Role[] } = {},
): Promise<{ personnel: Personnel } | { reponse: NextResponse }> {
  if (!lecture && !requeteDuSite(requete)) return { reponse: refus("Requête refusée.", 403) };
  const personnel = await personnelCourant();
  if (!personnel) return { reponse: refus("Session terminée. Reconnectez-vous.", 401) };
  if (!roles.includes(personnel.role)) return { reponse: refus(personnel.role === "livreur" ? "Réservé à la tablette du restaurant." : "Réservé aux livreurs.", 403) };
  return { personnel };
}

// Page /livreur et ses routes : rôle livreur seulement.
export function exigerLivreur(requete: Request, options: { lecture?: boolean } = {}) {
  return exigerPersonnel(requete, { ...options, roles: ["livreur"] });
}

export function auteur(p: Personnel): string {
  return `${p.role === "livreur" ? "livreur" : "tablette"}:${p.nom}`;
}

// Back-office : même contrôle, et rôle gérant exigé.
export async function exigerGerant(
  requete: Request,
  options: { lecture?: boolean } = {},
): Promise<{ personnel: Personnel } | { reponse: NextResponse }> {
  const g = await exigerPersonnel(requete, options);
  if ("reponse" in g) return g;
  if (g.personnel.role !== "gerant") return { reponse: refus("Réservé au gérant.", 403) };
  return g;
}
