import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { exigerPersonnel } from "@/lib/personnel/session";
import { fileTablette } from "@/lib/tablette";

// File de la tablette, relue toutes les 5 secondes (et tout de suite au signal Realtime).
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [commandes, config] = await Promise.all([fileTablette(), chargerConfigService()]);
  return NextResponse.json(
    {
      maintenant: new Date().toISOString(),
      commandes,
      reglages: { pause: config.pause ?? null, preparation_minutes: config.reglages.preparation_minutes },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
