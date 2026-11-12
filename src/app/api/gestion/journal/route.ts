import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("journal_gestion_recent", { p_limite: 200 }), { headers: { "Cache-Control": "no-store" } });
}

// Retour arrière d'une modification (audit du gérant, G11) : { action: "annuler", id }. La base vérifie que
// rien n'a changé depuis, refait l'ancienne valeur par les mêmes fonctions que l'écran et journalise.
const ERREURS: Record<string, string> = {
  deja_change: "La valeur a changé depuis. Rien n'est remis : corrigez à la main.",
  deja_annule: "Cette modification est déjà annulée.",
  non_annulable: "Cette ligne ne s'annule pas ici (équipe, remboursement, import ou imprimante).",
  journal_inconnu: "Ligne introuvable.",
  "Réservé au gérant": "Réservé au gérant.",
};

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || c.action !== "annuler" || !Number.isInteger(c.id) || (c.id as number) < 1) return refus("Ligne introuvable.", 404);
  try {
    await fonctionSql("annuler_journal", { p_id: c.id, p_personnel: g.personnel.id });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const k = Object.keys(ERREURS).find((x) => m.includes(x));
    if (k) return refus(ERREURS[k], 409);
    throw e;
  }
  // Prix, zones, horaires, fermetures : les pages publiques suivent tout de suite.
  rafraichirCaches("catalogue");
  rafraichirCaches("config-service");
  return NextResponse.json({ enregistre: true, message: "Ancienne valeur remise." });
}
