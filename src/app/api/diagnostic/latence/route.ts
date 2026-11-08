import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { lirePublic } from "@/lib/db/lecture";

export const dynamic = "force-dynamic";

// Préversions seulement : temps d'aller-retour entre la fonction Netlify et la base Supabase de Zurich.
// Sert à comparer deux régions de fonctions (docs/performance.md). Ne renvoie que des durées.
export async function GET() {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") return new NextResponse(null, { status: 404 });
  const base: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await lirePublic("reglages");
    base.push(Math.round(performance.now() - t));
  }
  const t = performance.now();
  await chargerConfigService();
  const cache = Math.round(performance.now() - t);
  const tri = [...base].sort((a, b) => a - b);
  return NextResponse.json(
    { region: process.env.AWS_REGION ?? null, base_ms: base, base_mediane_ms: tri[2], cache_ms: cache },
    { headers: { "Cache-Control": "no-store" } },
  );
}
