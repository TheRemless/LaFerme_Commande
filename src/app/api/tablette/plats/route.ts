import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerPersonnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Plats commandables et leur rupture du jour.
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("plats_tablette", {}), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (!corps || typeof corps.slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(corps.slug) || typeof corps.rupture !== "boolean") {
    return refus("Plat inconnu.", 404);
  }
  const ok = await fonctionSql<boolean>("regler_rupture", { p_slug: corps.slug, p_rupture: corps.rupture, p_personnel: g.personnel.id });
  if (!ok) return refus("Plat inconnu.", 404);
  rafraichirCaches("catalogue");
  await signalerTablette();
  return NextResponse.json({ enregistre: true });
}
