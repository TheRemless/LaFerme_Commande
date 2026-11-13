import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { centimes, champsHoraire, champsZone, dateValide } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";
import { fermerZone, reglerServicesZone, rouvrirZone } from "@/lib/zones-operations";

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
  // Plafond du paiement au comptoir (décision de Jérémy, 100 CHF au départ) : null si absent.
  const plafond = cap("plafond_comptoir_centimes")?.valeur;
  // Tickets des commandes à l'avance (SS-11) : minutes avant l'heure promise, par mode. Absent avant la migration.
  const avL = cap("impression_avance_livraison_minutes");
  const avR = cap("impression_avance_retrait_minutes");
  const impressionAvance = avL && avR ? { livraison: Number(avL.valeur), retrait: Number(avR.valeur), proposition: avL.proposition || avR.proposition } : null;
  return NextResponse.json(
    { ouvertures: [], ...service, capacites, preparation, plafond_comptoir_centimes: typeof plafond === "number" ? plafond : null, impressionAvance },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  } else if (c.type === "zone-services" || c.type === "zone-fermer" || c.type === "zone-rouvrir") {
    // Zone par service, zone fermée jusqu'à une heure (vague 3) : contrôles et cache dans zones-operations.ts.
    const r =
      c.type === "zone-services"
        ? await reglerServicesZone(g.personnel, c.numero, c.services)
        : c.type === "zone-fermer"
          ? await fermerZone(g.personnel, c.numero, c.jusqua, c.motif)
          : await rouvrirZone(g.personnel, c.numero);
    if (!r.ok) return refus(r.erreur, r.code);
    return NextResponse.json({ enregistre: true, ...("deja" in r ? { deja: r.deja } : {}) });
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
    // Journée entière (service absent) ou un seul service (midi, soir) d'un jour (audit du gérant, vague 2).
    const debut = dateValide(c.debut);
    const service = c.service === "midi" || c.service === "soir" ? c.service : null;
    const fin = service ? debut : dateValide(c.fin);
    const motif = typeof c.motif === "string" ? c.motif.trim() : "";
    if (!debut || !fin || fin < debut) return refus("Dates de fermeture invalides.");
    if (motif.length < 2 || motif.length > 120) return refus("Indiquez un motif (120 caractères au plus).");
    if (service) await fonctionSql("ajouter_fermeture_service", { p_jour: debut, p_service: service, p_motif: motif, p_personnel: qui });
    else await fonctionSql("ajouter_fermeture", { p_debut: debut, p_fin: fin, p_motif: motif, p_personnel: qui });
    // Commandes déjà prises sur la période : à annuler sur la tablette (G15).
    const prises = await fonctionSql<number[]>("commandes_dans_periode", { p_debut: debut, p_fin: fin, p_service: service }).catch(() => []);
    rafraichirCaches("config-service");
    return NextResponse.json({ enregistre: true, commandes: prises });
  } else if (c.type === "ouverture") {
    const jour = dateValide(c.jour);
    const service = c.service === "midi" || c.service === "soir" ? c.service : null;
    const motif = typeof c.motif === "string" ? c.motif.trim() : "";
    const heures = champsHoraire(c.champs);
    if (!jour || !service) return refus("Choisissez le jour et le service.");
    if (!heures.ok) return refus(heures.erreur);
    if (motif.length < 2 || motif.length > 120) return refus("Indiquez un motif (120 caractères au plus).");
    try {
      await fonctionSql("ajouter_ouverture", { p: { jour, service, motif, ...heures.valeur }, p_personnel: qui });
    } catch (e) {
      if (e instanceof Error && /duplicate|unique/i.test(e.message)) return refus("Ce service est déjà ouvert ce jour-là.");
      throw e;
    }
  } else if (c.type === "ouverture-suppr") {
    const id = entier(c.id);
    if (!id) return refus("Ouverture inconnue.", 404);
    ok = await fonctionSql<boolean>("supprimer_ouverture", { p_id: id, p_personnel: qui });
  } else if (c.type === "npa") {
    // Communes d'une zone : ajouter (ou déplacer) un couple NPA et localité, ou le retirer.
    const npa = typeof c.npa === "string" ? c.npa.trim() : "";
    const localite = typeof c.localite === "string" ? c.localite.trim() : "";
    if (!/^12\d{2}$/.test(npa)) return refus("NPA genevois à 4 chiffres (12xx).");
    if (localite.length < 2 || localite.length > 60) return refus("Écrivez la localité comme sur l'adresse officielle.");
    if (c.retirer === true) ok = await fonctionSql<boolean>("retirer_npa_zone", { p_npa: npa, p_localite: localite, p_personnel: qui });
    else {
      const zone = entier(c.zone);
      if (!zone) return refus("Zone inconnue.", 404);
      try {
        await fonctionSql("ajouter_npa_zone", { p_npa: npa, p_localite: localite, p_zone: zone, p_personnel: qui });
      } catch (e) {
        if (e instanceof Error && e.message.includes("zone_inconnue")) return refus("Zone inconnue.", 404);
        throw e;
      }
    }
  } else if (c.type === "plafond") {
    const v = centimes(c.francs);
    if (v === null) return refus("Plafond : un montant en francs de 0 à 500.");
    await fonctionSql("regler_plafond_comptoir", { p_centimes: v, p_personnel: qui });
  } else if (c.type === "fermeture-suppr") {
    const id = entier(c.id);
    if (!id) return refus("Fermeture inconnue.", 404);
    ok = await fonctionSql<boolean>("supprimer_fermeture", { p_id: id, p_personnel: qui });
  } else return refus("Type inconnu.");
  if (!ok) return refus("Introuvable.", 404);
  rafraichirCaches("config-service");
  return NextResponse.json({ enregistre: true });
}
