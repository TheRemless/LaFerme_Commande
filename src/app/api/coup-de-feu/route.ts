import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { etatCoupDeFeu, finirCoupDeFeu, lancerCoupDeFeu } from "@/lib/coup-de-feu";
import { exigerPersonnel } from "@/lib/personnel/session";

// Coup de feu : tablette (rôle service) et back-office (gérant). Les livreurs n'y ont pas accès.
// GET : état. POST { action: "lancer", retard_minutes, duree_minutes, livraison_fermee, capacite_livraison,
// capacite_retrait } ou { action: "finir" }.
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await etatCoupDeFeu(), { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  if (c.action === "lancer") {
    const r = await lancerCoupDeFeu(g.personnel, c);
    if (!r.ok) return refus(r.erreur);
    return NextResponse.json({ enregistre: true, ...r.etat }, { headers: SANS_CACHE });
  }
  if (c.action === "finir") {
    const r = await finirCoupDeFeu(g.personnel);
    // Déjà fini (autre appareil, fin automatique) : pas une erreur, l'état dit ce qu'il en est.
    return NextResponse.json({ enregistre: r.ok, deja: !r.ok, ...r.etat }, { headers: SANS_CACHE });
  }
  return refus("Action inconnue.");
}
