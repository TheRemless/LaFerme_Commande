import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { messageReglagesFidelite, reglagesFidelite, reglerFidelite } from "@/lib/cagnotte";
import { exigerGerant } from "@/lib/personnel/session";

// Réglages de la cagnotte (vague 3, client-compte) : taux, seuil d'utilisation, soirs doublés, et le montant dû aux
// clients pour la fiduciaire. L'interrupteur général est dans les Réglages généraux (interrupteurs_gestion).
const sansCache = { headers: { "Cache-Control": "no-store" } };

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await reglagesFidelite(), sansCache);
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  const soirs = c?.soirs_doubles as { jours?: unknown; dates?: unknown } | undefined;
  const p = {
    taux_pourcent: Number(c?.taux_pourcent),
    seuil_centimes: Number(c?.seuil_centimes),
    soirs_doubles: {
      jours: Array.isArray(soirs?.jours) ? soirs.jours.filter((j): j is number => Number.isInteger(j)) : [],
      dates: Array.isArray(soirs?.dates) ? soirs.dates.filter((d): d is string => typeof d === "string") : [],
    },
  };
  try {
    return NextResponse.json(await reglerFidelite(p, g.personnel.id), sansCache);
  } catch (e) {
    const m = messageReglagesFidelite(e);
    if (m) return refus(m, 422);
    throw e;
  }
}
