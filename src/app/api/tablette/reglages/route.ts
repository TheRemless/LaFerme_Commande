import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { auteur, exigerPersonnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Pause des commandes en ligne, livraison fermée, délai de préparation du moment.
// pause : nombre de minutes (15 à 240), "sans-fin", ou "reprendre".
export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (!corps) return refus("Requête illisible.", 400);
  const p: Record<string, unknown> = {};
  if (corps.pause !== undefined) {
    if (corps.pause === "reprendre") p.pause_jusqu_a = null;
    else if (corps.pause === "sans-fin") p.pause_jusqu_a = "sans-fin";
    else if (Number.isInteger(corps.pause) && (corps.pause as number) >= 15 && (corps.pause as number) <= 240) {
      p.pause_jusqu_a = new Date(Date.now() + (corps.pause as number) * 60_000).toISOString();
    } else return refus("Durée de pause invalide.");
  }
  if (corps.livraisonFermee !== undefined) {
    if (typeof corps.livraisonFermee !== "boolean") return refus("Valeur invalide.");
    p.livraison_fermee = corps.livraisonFermee;
  }
  if (corps.preparation !== undefined) {
    if (!Number.isInteger(corps.preparation) || (corps.preparation as number) < 5 || (corps.preparation as number) > 120) return refus("Délai invalide.");
    p.preparation_minutes = corps.preparation;
  }
  if (Object.keys(p).length === 0) return refus("Rien à changer.");
  await fonctionSql("regler_service", { p, p_par: auteur(g.personnel) });
  rafraichirCaches("config-service");
  await signalerTablette();
  return NextResponse.json({ enregistre: true });
}
