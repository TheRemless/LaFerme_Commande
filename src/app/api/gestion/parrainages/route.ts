import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";

// Rubrique Parrainages (vague 3, client-compte) : gérant seulement. GET : parrains, filleuls, signaux. POST :
// { action: "suspendre", parrain, motif } | { action: "reactiver", parrain } | { action: "classer", signal }.
// Les identifiants vont dans le corps, jamais dans l'adresse.
const sansCache = { headers: { "Cache-Control": "no-store" } };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("parrainages_gestion", {}), sansCache);
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  try {
    if (c?.action === "suspendre" && uuid(c.parrain)) {
      const motif = typeof c.motif === "string" ? c.motif.trim() : "";
      if (motif.length < 3 || motif.length > 200) return refus("Écrivez pourquoi (3 à 200 caractères).", 422);
      await fonctionSql("suspendre_parrain", { p_compte: c.parrain, p_motif: motif, p_personnel: g.personnel.id });
      return NextResponse.json({ ok: true }, sansCache);
    }
    if (c?.action === "reactiver" && uuid(c.parrain)) {
      return NextResponse.json({ ok: await fonctionSql<boolean>("reactiver_parrain", { p_compte: c.parrain, p_personnel: g.personnel.id }) }, sansCache);
    }
    if (c?.action === "classer" && Number.isInteger(c.signal)) {
      return NextResponse.json({ ok: await fonctionSql<boolean>("classer_alerte_parrainage", { p_id: c.signal, p_personnel: g.personnel.id }) }, sansCache);
    }
  } catch (e) {
    if (e instanceof Error && /suspension_refusee:motif/.test(e.message)) return refus("Écrivez pourquoi (3 à 200 caractères).", 422);
    if (e instanceof Error && /suspension_refusee:compte/.test(e.message)) return refus("Parrain introuvable.", 404);
    throw e;
  }
  return refus("Action inconnue.", 400);
}
