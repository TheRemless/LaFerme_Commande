// Disponibilités d'un plat de la carte (service, mode, jours de la semaine) et rupture planifiée.
// Fonctions pures, les mêmes dans le navigateur (carte) et sur le serveur (panier, paiement), qui seul
// fait foi. Les restrictions viennent de la base (colonnes dispo_* de plats), aucune n'est écrite ici.
import { ajouterJours, jourIso, jourTexte, type Mode } from "@/lib/service";

export type ServiceDispo = "midi" | "soir";
export type Dispo = { service: ServiceDispo | null; mode: Mode | null; jours: number[] | null };
// Moment de remise demandé : date, heure en minutes, service des horaires s'il est connu, mode choisi.
export type MomentDispo = { date: string; minutes: number; service?: ServiceDispo; mode?: Mode };

const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
// Même repli que le plat du jour quand les horaires ne sont pas là : avant 15h, service de midi.
const BASCULE_SOIR = 15 * 60;

// « vendredi 21 novembre », comme les créneaux (jourTexte).
export const dateEnLettres = jourTexte;

// « le vendredi et le samedi », « du mardi au samedi » (trois jours de suite ou plus), « le lundi ».
export function joursEnLettres(jours: number[]): string {
  const tri = [...new Set(jours)].sort((a, b) => a - b);
  const suite = tri.length >= 3 && tri.every((j, i) => i === 0 || j === tri[i - 1] + 1);
  if (suite) return `du ${NOMS_JOURS[tri[0] - 1]} au ${NOMS_JOURS[tri[tri.length - 1] - 1]}`;
  const noms = tri.map((j) => `le ${NOMS_JOURS[j - 1]}`);
  return noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

// Lecture sûre de ce que donne la base : toute valeur inconnue vaut « sans restriction ».
export function dispoDe(l: { dispo_service?: string | null; dispo_mode?: string | null; dispo_jours?: number[] | null }): Dispo | null {
  const service = l.dispo_service === "midi" || l.dispo_service === "soir" ? l.dispo_service : null;
  const mode = l.dispo_mode === "livraison" || l.dispo_mode === "retrait" ? l.dispo_mode : null;
  const jours = Array.isArray(l.dispo_jours) && l.dispo_jours.length > 0 ? l.dispo_jours.map(Number).filter((j) => j >= 1 && j <= 7) : null;
  return service || mode || jours?.length ? { service, mode, jours: jours?.length ? jours : null } : null;
}

// Pourquoi ce plat ne peut pas être pris pour ce moment, ou null s'il le peut. Sans moment connu
// (panier sans créneau), seule la rupture planifiée compte, comme si la remise était aujourd'hui.
export function motifDisponibilite(
  plat: { dispo?: Dispo | null; rupture_jusqu_au?: string | null },
  moment: MomentDispo | null,
  aujourdhui: string,
): string | null {
  const date = moment?.date ?? aujourdhui;
  if (plat.rupture_jusqu_au && date <= plat.rupture_jusqu_au) {
    return `Épuisé. De retour le ${dateEnLettres(ajouterJours(plat.rupture_jusqu_au, 1))}.`;
  }
  const d = plat.dispo;
  if (!d || !moment) return null;
  if (d.jours && !d.jours.includes(jourIso(moment.date))) return `Seulement ${joursEnLettres(d.jours)}.`;
  if (d.service && (moment.service ?? (moment.minutes < BASCULE_SOIR ? "midi" : "soir")) !== d.service) {
    return d.service === "midi" ? "Seulement à midi." : "Seulement le soir.";
  }
  if (d.mode && moment.mode && moment.mode !== d.mode) return d.mode === "livraison" ? "Seulement en livraison." : "Seulement à emporter.";
  return null;
}
