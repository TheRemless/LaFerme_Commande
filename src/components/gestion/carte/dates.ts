// « ven. 13 nov. » : date courte des écrans de la carte (ruptures, groupes, promotions).
const JOUR = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const jourCourtFr = (iso: string) => JOUR.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
