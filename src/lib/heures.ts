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

// « 09:30 » pour des minutes depuis minuit (format attendu par depuisHeureGeneve).
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
