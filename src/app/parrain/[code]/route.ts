import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_PARRAIN, codeParrainValide, DUREE_PARRAIN_S } from "@/lib/parrainage";

// Lien de parrainage : le code est gardé dans un cookie (30 jours, illisible par les pages), puis on va à l'accueil.
// L'adresse ne porte que le code, jamais une donnée du client. Le compte créé ensuite est rattaché à la connexion.
export async function GET(requete: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = codeParrainValide((await params).code);
  const rep = NextResponse.redirect(new URL("/", requete.url), 303);
  // Un parrain déjà retenu n'est pas remplacé par un lien suivant (revue de sécurité : un site tiers ne prend pas la
  // place du proche qui a envoyé le premier lien).
  const deja = codeParrainValide((await cookies()).get(COOKIE_PARRAIN)?.value);
  if (code && !deja) {
    rep.cookies.set(COOKIE_PARRAIN, code, {
      httpOnly: true,
      secure: process.env.CONTEXTE_DEPLOIEMENT !== "local",
      sameSite: "lax",
      path: "/",
      maxAge: DUREE_PARRAIN_S,
    });
  }
  return rep;
}
