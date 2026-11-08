import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { exigerPersonnel } from "@/lib/personnel/session";
import { executerSurveillance } from "@/lib/surveillance";
import { fileTablette } from "@/lib/tablette";

// File de la tablette, relue toutes les 5 secondes (et tout de suite au signal Realtime).
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  // Signe de vie de la tablette (la surveillance met le site en pause s'il disparaît pendant le service).
  await fonctionSql("signe_tablette", {});
  await executerSurveillance().catch((e) => console.error(`Surveillance : ${e instanceof Error ? e.message : e}`));
  const [commandes, config, impression] = await Promise.all([fileTablette(), chargerConfigService(), etatImpression()]);
  return NextResponse.json(
    {
      maintenant: new Date().toISOString(),
      commandes,
      reglages: { pause: config.pause ?? null, preparation_minutes: config.reglages.preparation_minutes },
      impression,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
