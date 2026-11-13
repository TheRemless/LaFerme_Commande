import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { exigerLivreur } from "@/lib/personnel/session";
import { effacerPosition, noterPosition } from "@/lib/position-livreur";

// Téléphone du livreur pendant le trajet : POST { lat, lon, precision } envoie sa position, POST { fin: true } l'efface
// (plus en route, page fermée). La base décide si la position est gardée (arrêt en cours parti, réglage ouvert).
// → 200 { statut: 'ok' | 'pas_en_route' | 'ignoree' | 'desactive', numero? } | 200 { ok: true } | 400, 401, 403
const SANS_CACHE = { "Cache-Control": "no-store, private" };
const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export async function POST(requete: Request) {
  const g = await exigerLivreur(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (c?.fin === true) {
    await effacerPosition(g.personnel);
    return NextResponse.json({ ok: true }, { headers: SANS_CACHE });
  }
  if (!c || !nombre(c.lat) || !nombre(c.lon) || !nombre(c.precision) || c.precision < 0) return refus("Position illisible.", 400);
  return NextResponse.json(await noterPosition(g.personnel, c.lat, c.lon, c.precision), { headers: SANS_CACHE });
}
