import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { NextResponse } from "next/server";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import type { ActionDroit } from "@/lib/personnel/droits";

// Session du personnel, à part de celle des clients : autre cookie, autres empreintes, autre table.
// SameSite=Strict : la tablette n'arrive jamais sur le site par un lien venu d'ailleurs. 60 jours.

// « responsable » : rôle de la décision D1, attribuable seulement quand role_responsable_actif est à true.
export type Role = "service" | "gerant" | "livreur" | "responsable";
export type Personnel = { id: string; email: string; nom: string; role: Role };

// La tablette et ses routes : service et gérant. Un livreur n'y entre pas (il ne voit que ses livraisons,
// sur /livreur) : il faut le demander explicitement avec roles.
// Un responsable de service a tous les gestes de la tablette (D1).
const ROLES_TABLETTE: readonly Role[] = ["service", "gerant", "responsable"];

const DUREE_S = 60 * 24 * 60 * 60;
// Livreur : téléphone personnel, souvent dans la poche ou perdu. Une soirée, pas 60 jours (audit de sécurité 2, S2-15).
// La base borne aussi la session (personnel_de_session).
export const DUREE_LIVREUR_S = 12 * 60 * 60;

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

// Une action du tableau D1 (src/lib/personnel/droits.ts) : le gérant, ou un responsable de service quand le
// rôle est activé. La base revérifie avec auteur_droit dans la fonction qui écrit.
export async function exigerDroit(
  requete: Request,
  action: ActionDroit,
  options: { lecture?: boolean } = {},
): Promise<{ personnel: Personnel } | { reponse: NextResponse }> {
  const g = await exigerPersonnel(requete, options);
  if ("reponse" in g) return g;
  if (g.personnel.role === "gerant") return g;
  if (g.personnel.role === "responsable" && (await fonctionSql<boolean>("droit_personnel", { p_personnel: g.personnel.id, p_action: action }))) return g;
  return { reponse: refus("Réservé au gérant.", 403) };
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
