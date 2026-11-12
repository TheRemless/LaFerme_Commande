import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerPersonnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Suppléments et leur rupture du jour (audit du gérant, G07) : comme les plats, ils reviennent seuls le lendemain.
export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const liste = await fonctionSql("options_tablette", {}).catch(() => []);
  return NextResponse.json(liste, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.groupe !== "string" || !/^[a-z0-9-]{1,80}$/.test(c.groupe) || typeof c.nom !== "string" || c.nom.length > 80 || typeof c.rupture !== "boolean") {
    return refus("Supplément inconnu.", 404);
  }
  const ok = await fonctionSql<boolean>("regler_rupture_option", { p_groupe: c.groupe, p_nom: c.nom, p_rupture: c.rupture, p_personnel: g.personnel.id });
  if (!ok) return refus("Supplément inconnu.", 404);
  rafraichirCaches("catalogue");
  await signalerTablette();
  return NextResponse.json({ enregistre: true });
}
