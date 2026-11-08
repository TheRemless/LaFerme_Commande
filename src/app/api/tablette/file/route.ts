import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { exigerPersonnel } from "@/lib/personnel/session";
import { etatService } from "@/lib/service";
import { surveillanceAuPassage } from "@/lib/surveillance";
import { fileTablette } from "@/lib/tablette";

// Signe de vie de la tablette : la surveillance met le site en pause s'il manque 3 minutes pendant le
// service. Une écriture toutes les 30 secondes au plus par instance de fonction suffit largement.
let dernierSigne = 0;
async function signeDeVie(): Promise<void> {
  const t = Date.now();
  if (t - dernierSigne < 30_000) return;
  dernierSigne = t;
  await fonctionSql("signe_tablette", {});
}

// Rythme de relecture proposé à la tablette (docs/impression.md, « Coût en requêtes ») : 15 secondes
// pendant le service ou tant qu'une commande est en cours, 60 secondes sinon. Le signal Realtime
// prévient de toute nouvelle commande sans attendre.
const RELECTURE_SERVICE_S = 15;
const RELECTURE_VEILLE_S = 60;
const ACTIVES = new Set(["nouvelle", "acceptee", "en_preparation", "prete", "partie"]);

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  await Promise.all([signeDeVie(), surveillanceAuPassage()]);
  const [commandes, config, impression] = await Promise.all([fileTablette(), chargerConfigService(), etatImpression()]);
  const maintenant = new Date();
  const etat = etatService(config, maintenant, "retrait").etat;
  const enService = etat === "ouvert" || etat === "pause" || commandes.some((c) => ACTIVES.has(c.statut));
  return NextResponse.json(
    {
      maintenant: maintenant.toISOString(),
      commandes,
      reglages: { pause: config.pause ?? null, preparation_minutes: config.reglages.preparation_minutes },
      impression,
      relecture_s: enService ? RELECTURE_SERVICE_S : RELECTURE_VEILLE_S,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
