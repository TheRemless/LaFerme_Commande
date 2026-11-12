// Heures et jours à Genève pour l'affichage (navigateur et serveur).

const HEURE = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
const JOUR_ISO = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" });

// « 19h45 » pour un instant donné.
export function heureDe(instant: string | Date): string {
  return HEURE.format(new Date(instant)).replace(":", "h");
}

// « 2026-11-10 » : le jour à Genève d'un instant donné.
export function jourGeneveDe(instant: string | Date): string {
  return JOUR_ISO.format(new Date(instant));
}

// « vendredi 13.11 » : le jour à Genève d'un instant, en court, pour la tablette.
const JOUR_COURT = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "2-digit", month: "2-digit" });
export function jourCourtDe(instant: string | Date): string {
  return JOUR_COURT.format(new Date(instant)).replace(",", "").replace(/\.$/, "");
}

// « 09:30 » pour des minutes depuis minuit (format attendu par depuisHeureGeneve).
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
