import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { lireEtatSurveillance } from "@/lib/db/serveur";
import { evaluerSante } from "@/lib/sante";
import { dansUnService } from "@/lib/surveillance";

export const dynamic = "force-dynamic";

// Route de santé pour le service de disponibilité (docs/filet.md) : 200 si le site et la base répondent
// et que la surveillance tourne, 503 sinon. Aucune donnée personnelle. Une réponse gardée 15 secondes par
// instance : une rafale d'appels ne coûte pas une lecture de la base chacun.
const GARDE_MS = 15_000;
const DELAI_BASE_MS = 5_000;
let derniere: { le: number; http: number; corps: unknown } | null = null;

function avecDelai<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rejeter) => setTimeout(() => rejeter(new Error("délai dépassé")), DELAI_BASE_MS))]);
}

export async function GET() {
  if (!derniere || Date.now() - derniere.le > GARDE_MS) {
    const maintenant = new Date();
    const t = performance.now();
    const etat = await avecDelai(lireEtatSurveillance()).catch((e) => {
      console.error(`Santé : base injoignable (${e instanceof Error ? e.message : e})`);
      return null;
    });
    const ms = Math.round(performance.now() - t);
    const config = etat ? await avecDelai(chargerConfigService()).catch(() => null) : null;
    const r = evaluerSante({
      maintenant,
      contexte: process.env.CONTEXTE_DEPLOIEMENT ?? "local",
      version: process.env.VERSION_SITE || null,
      base: { ok: etat !== null, ms },
      etat,
      enService: config ? dansUnService(config, maintenant) : false,
    });
    derniere = { le: Date.now(), ...r };
  }
  return NextResponse.json(derniere.corps, { status: derniere.http, headers: { "Cache-Control": "no-store" } });
}
