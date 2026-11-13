// Périodes du back-office, en jours de Genève (AAAA-MM-JJ). Calcul sur des dates à midi UTC :
// aucun décalage d'heure d'été ne peut faire sauter un jour.

export type Periode = { debut: string; fin: string };
export type CleRaccourciPeriode = "aujourdhui" | "hier" | "7jours" | "30jours" | "mois" | "mois-dernier";

export const RACCOURCIS_PERIODE: { cle: CleRaccourciPeriode; libelle: string }[] = [
  { cle: "aujourdhui", libelle: "Aujourd'hui" },
  { cle: "hier", libelle: "Hier" },
  { cle: "7jours", libelle: "7 derniers jours" },
  { cle: "30jours", libelle: "30 derniers jours" },
  { cle: "mois", libelle: "Ce mois-ci" },
  { cle: "mois-dernier", libelle: "Mois dernier" },
];

const versDate = (j: string) => new Date(`${j}T12:00:00Z`);
const versJour = (d: Date) => d.toISOString().slice(0, 10);

export function decalerJour(jour: string, jours: number): string {
  const d = versDate(jour);
  d.setUTCDate(d.getUTCDate() + jours);
  return versJour(d);
}

export function estJour(j: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(j) && versJour(versDate(j)) === j;
}

/** Nombre de jours d'une période, bornes comprises. */
export function dureeJours(p: Periode): number {
  return Math.round((versDate(p.fin).getTime() - versDate(p.debut).getTime()) / 86_400_000) + 1;
}

export function periodeDe(cle: CleRaccourciPeriode, aujourdhui: string): Periode {
  switch (cle) {
    case "aujourdhui":
      return { debut: aujourdhui, fin: aujourdhui };
    case "hier": {
      const h = decalerJour(aujourdhui, -1);
      return { debut: h, fin: h };
    }
    case "7jours":
      return { debut: decalerJour(aujourdhui, -6), fin: aujourdhui };
    case "30jours":
      return { debut: decalerJour(aujourdhui, -29), fin: aujourdhui };
    case "mois":
      return { debut: `${aujourdhui.slice(0, 7)}-01`, fin: aujourdhui };
    case "mois-dernier": {
      const finMoisDernier = decalerJour(`${aujourdhui.slice(0, 7)}-01`, -1);
      return { debut: `${finMoisDernier.slice(0, 7)}-01`, fin: finMoisDernier };
    }
  }
}

/** Le raccourci qui donne exactement cette période, s'il y en a un. */
export function raccourciDe(p: Periode, aujourdhui: string): CleRaccourciPeriode | null {
  return RACCOURCIS_PERIODE.find((r) => {
    const q = periodeDe(r.cle, aujourdhui);
    return q.debut === p.debut && q.fin === p.fin;
  })?.cle ?? null;
}

/** La période de comparaison habituelle : la même durée juste avant (un jour : le même jour de la semaine passée). */
export function periodeComparaison(p: Periode): Periode {
  const n = dureeJours(p);
  const recul = n === 1 ? 7 : n;
  return { debut: decalerJour(p.debut, -recul), fin: decalerJour(p.fin, -recul) };
}

/** Erreur lisible, ou null si la période est valable (au plus `maxJours`). */
export function verifierPeriode(p: Periode, maxJours = 366): string | null {
  if (!estJour(p.debut) || !estJour(p.fin)) return "Choisissez deux dates.";
  if (p.debut > p.fin) return "La date de début est après la date de fin.";
  if (dureeJours(p) > maxJours) return `Une période de ${maxJours} jours au plus.`;
  return null;
}
