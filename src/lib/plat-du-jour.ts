// Plat du jour : vendu seulement le jour dit et pour son service (midi, soir ou les deux).
// Fonctions pures, les mêmes dans le navigateur (carte) et sur le serveur (panier, commande).
import { motifDisponibilite } from "@/lib/disponibilite";
import type { ServiceJour } from "@/lib/gestion";
import type { Catalogue } from "@/lib/panier";
import { enMinutes, etatService, instantGeneve, jourIso, type ConfigService, type Mode, type Quand, type Zone } from "@/lib/service";

export type { ServiceJour };
export type JourPlat = { date: string; service: ServiceJour };
// service : celui des horaires quand on le connaît (serveur), sinon déduit de l'heure (navigateur).
// mode : livraison ou retrait, pour les plats réservés à l'un des deux.
export type Moment = { date: string; minutes: number; service?: "midi" | "soir"; mode?: Mode };

// Repli quand les horaires ne sont pas là (carte dans le navigateur) : une remise avant 15h appartient au
// service de midi, après au service du soir. Les horaires proposés finissent à 13h45 et commencent à 18h45.
export const BASCULE_SOIR = 15 * 60;

export function serviceDe(minutes: number): "midi" | "soir" {
  return minutes < BASCULE_SOIR ? "midi" : "soir";
}

// Date lue en base : texte « 2026-11-17 » (Supabase) ou objet Date (base embarquée).
export function dateDe(d: string | Date): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

// Pourquoi ce plat du jour ne peut pas être pris pour ce moment, ou null s'il le peut.
export function motifPlatDuJour(jour: JourPlat, moment: Moment): string | null {
  if (moment.date !== jour.date) return "Seulement aujourd'hui.";
  if (jour.service !== "journee" && (moment.service ?? serviceDe(moment.minutes)) !== jour.service) {
    return jour.service === "midi" ? "Seulement à midi." : "Seulement le soir.";
  }
  return null;
}

// Service des horaires qui contient cette heure de remise ce jour-là (null hors service).
export function serviceHoraire(config: Pick<ConfigService, "horaires">, date: string, minutes: number): "midi" | "soir" | null {
  const h = config.horaires.find((x) => x.jour === jourIso(date) && enMinutes(x.premiere_heure) <= minutes && minutes <= enMinutes(x.derniere_heure));
  return h?.service ?? null;
}

// Moment de remise demandé par le client : le créneau choisi, ou l'heure promise pour « dès que possible ».
export function momentDe(config: ConfigService, maintenant: Date, mode: Mode, zone: Zone | undefined, pizzas: boolean, quand: Quand): Moment | null {
  let m: Moment | null = null;
  if (quand.type === "creneau") m = { date: quand.date, minutes: quand.minutes };
  else if (quand.type === "asap") {
    const e = etatService(config, maintenant, mode, zone, pizzas);
    if (e.etat === "ouvert") m = { date: instantGeneve(maintenant).date, minutes: e.desQuePossible };
  }
  if (!m) return null;
  const service = serviceHoraire(config, m.date, m.minutes);
  return service ? { ...m, service, mode } : { ...m, mode };
}

// Premier plat du panier qui ne va pas avec le moment demandé : plat du jour d'un autre jour ou service,
// plat réservé à un service, un mode ou certains jours, rupture planifiée (src/lib/disponibilite.ts).
// « Osso buco : seulement à midi. » Appelée au panier et au paiement.
export function erreurPlatsDuJour(
  catalogue: Catalogue,
  lignes: { slug: string }[],
  moment: Moment | null,
  aujourdhui: string = instantGeneve(new Date()).date,
): string | null {
  for (const l of lignes) {
    const p = Object.hasOwn(catalogue.plats, l.slug) ? catalogue.plats[l.slug] : undefined;
    if (!p) continue;
    const motif = (p.jour && moment ? motifPlatDuJour(p.jour, moment) : null) ?? motifDisponibilite(p, moment, aujourdhui);
    if (motif) return `${p!.nom} : ${motif.charAt(0).toLowerCase()}${motif.slice(1)}`;
  }
  return null;
}

// Service affiché à côté du plat du jour sur la carte.
export const LIBELLE_SERVICE: Record<ServiceJour, string> = { midi: "À midi", soir: "Le soir", journee: "Midi et soir" };

// Moment choisi à l'accueil (navigateur) : le créneau, ou « dès que possible » avec l'heure annoncée.
export function momentDuChoix(quand: Quand, estimation: number | undefined, aujourdhui: string): Moment | null {
  if (quand.type === "creneau") return { date: quand.date, minutes: quand.minutes };
  if (quand.type === "asap" && estimation !== undefined) return { date: aujourdhui, minutes: estimation };
  return null;
}
