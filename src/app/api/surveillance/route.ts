import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleHmac, empreinte } from "@/lib/comptes/securite";
import { executerSurveillance } from "@/lib/surveillance";

// Déclencheur de la surveillance (fonction planifiée Netlify, chaque minute en production). Sans le jeton
// de la fonction planifiée, rien : un tiers ne peut pas lancer de tour sur la base, ni depuis une
// préversion (audit de sécurité, S10). Les passages des imprimantes et de la tablette n'en ont pas besoin.
export async function POST(requete: Request) {
  const recu = Buffer.from((requete.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const attendu = Buffer.from(jetonSurveillance());
  if (recu.length !== attendu.length || !timingSafeEqual(recu, attendu)) {
    return NextResponse.json({ erreur: "Refusé." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const r = await executerSurveillance();
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

// Même calcul que netlify/functions/surveillance.mts : HMAC de « surveillance:planifiee » avec la clé des empreintes.
function jetonSurveillance(): string {
  cleHmac();
  return empreinte("surveillance", "planifiee");
}
