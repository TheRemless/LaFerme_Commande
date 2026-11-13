import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerPersonnel } from "@/lib/personnel/session";
import { fileTablette, signalerTablette } from "@/lib/tablette";
import { vuePoste, type PosteActif, type Station } from "@/components/tablette/poste";

// Vue par poste (vague 3, D12 à l'essai, derrière le lien /tablette/poste/pizza) : GET ?station=pizza|cuisine,
// POST { commande, station, geste: "lancer" | "pret" | "rouvrir" }. Base : commande_postes, postes_actifs(),
// marquer_poste() (20261203120000). Avant la migration : vue vide, gestes refusés.
const SANS_CACHE = { "Cache-Control": "no-store" };
const STATIONS: Station[] = ["pizza", "cuisine"];
const GESTES = ["lancer", "pret", "rouvrir"];

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const station = new URL(requete.url).searchParams.get("station") as Station;
  if (!STATIONS.includes(station)) return refus("Poste inconnu.", 404);
  const [commandes, postes] = await Promise.all([fileTablette(), fonctionSql<PosteActif[]>("postes_actifs", {}).catch(() => [] as PosteActif[])]);
  return NextResponse.json({ maintenant: new Date().toISOString(), ...vuePoste(commandes, postes, station) }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const { commande, station, geste } = c as { commande?: unknown; station?: unknown; geste?: unknown };
  if (typeof commande !== "string" || !/^[0-9a-f-]{36}$/.test(commande)) return refus("Commande inconnue.", 404);
  if (!STATIONS.includes(station as Station) || !GESTES.includes(geste as string)) return refus("Geste inconnu.");
  const r = await fonctionSql<unknown>("marquer_poste", { p_commande: commande, p_station: station, p_geste: geste, p_personnel: g.personnel.id });
  if (r === null) return refus("Cette commande n'est plus en cuisine.", 409);
  await signalerTablette();
  return NextResponse.json({ enregistre: true }, { headers: SANS_CACHE });
}
