import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { annulerParClient } from "@/lib/annulation-client";

// Annulation par le client depuis son suivi, avant l'acceptation (vague 3, arbitrage C1). Le jeton de suivi
// voyage dans le corps, jamais dans l'adresse. Désactivée tant que le réglage annulation_client_active est faux :
// la route répond alors 403 avec le numéro du restaurant.
// POST { jeton } → 200 { ok: true, message } | 403, 404, 409 { erreur }
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const c = await corpsJson(requete);
  if (!c || typeof c.jeton !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(c.jeton)) return refus("Commande introuvable.", 404);
  const r = await annulerParClient(c.jeton);
  if (!r.ok) return refus(r.message, r.status);
  return NextResponse.json({ ok: true, message: r.message }, { headers: { "Cache-Control": "no-store" } });
}
