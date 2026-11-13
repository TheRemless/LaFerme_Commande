import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { jourGeneveDe } from "@/lib/heures";
import { exigerPersonnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Four en panne, cuisine en panne (vague 3, tablette) : tout un poste épuisé jusqu'à ce soir, en un geste confirmé.
// Base de bo-carte (20261210090000_disponibilites.sql) : ruptures_groupees_actives(), regler_rupture_groupee(cible,
// jusqu_au, personnel). Les ruptures plat par plat restent intactes quand on lève la panne. Avant cette migration :
// GET vide, POST refusé.
// GET : [{ cible, jusqu_au }]. POST { poste: "pizza" | "cuisine", panne: boolean }.
const SANS_CACHE = { "Cache-Control": "no-store" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const r = await fonctionSql<{ cible: string; jusqu_au: string }[]>("ruptures_groupees_actives", {}).catch(() => []);
  return NextResponse.json(r, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || (c.poste !== "pizza" && c.poste !== "cuisine") || typeof c.panne !== "boolean") return refus("Poste inconnu.");
  // Jusqu'à ce soir : le poste revient seul demain, comme une rupture du jour.
  const ok = await fonctionSql<boolean>("regler_rupture_groupee", { p_cible: `poste:${c.poste}`, p_jusqu_au: c.panne ? jourGeneveDe(new Date()) : null, p_personnel: g.personnel.id });
  if (!ok) return refus("Poste inconnu.");
  rafraichirCaches("catalogue");
  await signalerTablette();
  return NextResponse.json({ enregistre: true }, { headers: SANS_CACHE });
}
