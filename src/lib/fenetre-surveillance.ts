// Heures où la fonction planifiée lance la surveillance (Netlify sobre, 19.11.2026). Chaque appel coûte du calcul
// Netlify (10 crédits par Go-heure, docs/netlify-sobre.md) : hors de ces heures, la fonction sort sans appeler le
// site. Les services sont de 11h à 14h et de 18h30 à 23h (mardi à samedi) ; les fenêtres prennent une marge et tous
// les jours, pour couvrir une ouverture exceptionnelle à ces heures-là. Une ouverture en dehors (15h-17h30, après
// minuit) n'aurait ni refus automatique ni alerte « tablette muette » : élargir alors FENETRES_SURVEILLANCE et la
// planification de netlify/functions/surveillance.mts (test : tests/unit/fenetre-surveillance.test.ts).
// Sans dépendance : importé par la fonction planifiée de Netlify et par la route de santé.

// Minutes depuis minuit, heure de Genève : [début, fin).
export const FENETRES_SURVEILLANCE: readonly { debut: number; fin: number }[] = [
  { debut: 10 * 60, fin: 15 * 60 },
  { debut: 17 * 60 + 30, fin: 24 * 60 },
];

// Planification de la fonction (heures UTC) : toutes les 2 minutes de 8h à 13h59 et de 15h à 22h59 UTC, ce qui
// couvre les fenêtres en heure d'hiver comme en heure d'été. Doit rester identique à netlify/functions/surveillance.mts.
export const PLANIFICATION_SURVEILLANCE = "*/2 8-13,15-22 * * *";

const heureGeneve = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function minutesGeneve(d: Date): number {
  const parties = Object.fromEntries(heureGeneve.formatToParts(d).map((p) => [p.type, p.value]));
  return Number(parties.hour) * 60 + Number(parties.minute);
}

export function dansFenetreSurveillance(d: Date): boolean {
  const m = minutesGeneve(d);
  return FENETRES_SURVEILLANCE.some((f) => m >= f.debut && m < f.fin);
}
