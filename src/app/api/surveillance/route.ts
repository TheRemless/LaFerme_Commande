import { NextResponse } from "next/server";
import { executerSurveillance } from "@/lib/surveillance";

// Déclencheur de la surveillance (fonction planifiée Netlify, chaque minute en production).
// Sans secret : la surveillance ne fait rien de plus d'une fois par minute et n'agit que si une
// commande attend vraiment ou si la tablette est vraiment muette pendant le service.
export async function POST() {
  const r = await executerSurveillance();
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
