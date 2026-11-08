import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { champsHoraire, champsZone, dateValide } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("gestion_service", {}), { headers: { "Cache-Control": "no-store" } });
}

// { type: "zone", numero, champs } | { type: "horaire", id, champs }
// | { type: "fermeture", debut, fin, motif } | { type: "fermeture-suppr", id }
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const qui = g.personnel.id;
  const entier = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 10_000 ? (v as number) : null);
  let ok = true;
  if (c.type === "zone") {
    const n = entier(c.numero);
    const champs = champsZone(c.champs);
    if (!n) return refus("Zone inconnue.", 404);
    if (!champs.ok) return refus(champs.erreur);
    ok = await fonctionSql<boolean>("modifier_zone", { p_numero: n, p: champs.valeur, p_personnel: qui });
  } else if (c.type === "horaire") {
    const id = entier(c.id);
    const champs = champsHoraire(c.champs);
    if (!id) return refus("Horaire inconnu.", 404);
    if (!champs.ok) return refus(champs.erreur);
    ok = await fonctionSql<boolean>("modifier_horaire", { p_id: id, p: champs.valeur, p_personnel: qui });
  } else if (c.type === "fermeture") {
    const debut = dateValide(c.debut);
    const fin = dateValide(c.fin);
    const motif = typeof c.motif === "string" ? c.motif.trim() : "";
    if (!debut || !fin || fin < debut) return refus("Dates de fermeture invalides.");
    if (motif.length < 2 || motif.length > 120) return refus("Indiquez un motif (120 caractères au plus).");
    await fonctionSql("ajouter_fermeture", { p_debut: debut, p_fin: fin, p_motif: motif, p_personnel: qui });
  } else if (c.type === "fermeture-suppr") {
    const id = entier(c.id);
    if (!id) return refus("Fermeture inconnue.", 404);
    ok = await fonctionSql<boolean>("supprimer_fermeture", { p_id: id, p_personnel: qui });
  } else return refus("Type inconnu.");
  if (!ok) return refus("Introuvable.", 404);
  rafraichirCaches("config-service");
  return NextResponse.json({ enregistre: true });
}
