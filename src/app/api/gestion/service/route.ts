import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { champsHoraire, champsZone, dateValide } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [service, reglages] = await Promise.all([
    fonctionSql<Record<string, unknown>>("gestion_service", {}),
    lirePublic<{ cle: string; valeur: unknown; proposition: boolean }>("reglages"),
  ]);
  const cap = (cle: string) => reglages.find((r) => r.cle === cle);
  const capacites = {
    livraison: Number(cap("capacite_livraisons_par_creneau")?.valeur ?? 0),
    retrait: Number(cap("capacite_retraits_par_creneau")?.valeur ?? 0),
    proposition: Boolean(cap("capacite_livraisons_par_creneau")?.proposition || cap("capacite_retraits_par_creneau")?.proposition),
  };
  // Délai habituel (audit du gérant, G05) : réglé ici, plus sur la tablette, qui n'a que le retard du soir.
  const preparation = Number(cap("preparation_minutes")?.valeur ?? 20);
  // Tickets des commandes à l'avance (SS-11) : minutes avant l'heure promise, par mode. Absent avant la migration.
  const avL = cap("impression_avance_livraison_minutes");
  const avR = cap("impression_avance_retrait_minutes");
  const impressionAvance = avL && avR ? { livraison: Number(avL.valeur), retrait: Number(avR.valeur), proposition: avL.proposition || avR.proposition } : null;
  return NextResponse.json({ ...service, capacites, preparation, impressionAvance }, { headers: { "Cache-Control": "no-store" } });
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
  } else if (c.type === "capacite") {
    // Commandes au plus par créneau choisi (audit « samedi soir », SS-02). 0 : sans limite.
    const valeur = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50 ? (v as number) : null);
    const livraison = valeur(c.livraison);
    const retrait = valeur(c.retrait);
    if (livraison === null || retrait === null) return refus("Capacité : un nombre entier de 0 à 50.");
    await fonctionSql("regler_capacite", { p_mode: "livraison", p_valeur: livraison, p_personnel: qui });
    await fonctionSql("regler_capacite", { p_mode: "retrait", p_valeur: retrait, p_personnel: qui });
  } else if (c.type === "preparation") {
    const v = c.minutes;
    if (!Number.isInteger(v) || (v as number) < 5 || (v as number) > 120) return refus("Délai de préparation : un nombre de minutes de 5 à 120.");
    await fonctionSql("regler_service", { p: { preparation_minutes: v }, p_personnel: qui });
  } else if (c.type === "impression_avance") {
    const valeur = (v: unknown) => (Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 240 ? (v as number) : null);
    const livraison = valeur(c.livraison);
    const retrait = valeur(c.retrait);
    if (livraison === null || retrait === null) return refus("Tickets à l'avance : un nombre de minutes de 15 à 240.");
    await fonctionSql("regler_impression_avance", { p_mode: "livraison", p_valeur: livraison, p_personnel: qui });
    await fonctionSql("regler_impression_avance", { p_mode: "retrait", p_valeur: retrait, p_personnel: qui });
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
