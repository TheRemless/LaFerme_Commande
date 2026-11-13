// Chiffres du back-office (vague 3, bo-pilotage). Les calculs sont faits en base (pilotage_ventes) ;
// ce module ne fait que choisir les périodes et décrire ce qui revient.

import { dateValide } from "@/lib/gestion";

export type Part = { commandes: number; ttc_centimes: number };

export type TauxTva = {
  taux_pourcent: number;
  ttc_centimes: number;
  tva_centimes: number;
  ht_centimes: number;
  rembourse_centimes: number;
  tva_remboursee_centimes: number;
  net_ttc_centimes: number;
  net_tva_centimes: number;
  net_ht_centimes: number;
};

export type Synthese = {
  commandes: number;
  ttc_centimes: number;
  tva_centimes: number;
  ht_centimes: number;
  panier_moyen_centimes: number;
  encaisse_centimes: number;
  a_encaisser: number;
  a_encaisser_centimes: number;
  frais_centimes: number;
  livraison: Part;
  retrait: Part;
  en_ligne: Part;
  comptoir: Part;
  refusees: Part & { motifs: (Part & { motif: string })[] };
  remboursements: {
    faits: number;
    faits_centimes: number;
    faits_en_ligne_centimes: number;
    faits_especes_centimes: number;
    en_cours: number;
    en_cours_centimes: number;
    echecs: number;
    echecs_centimes: number;
  };
  net_ttc_centimes: number;
  tva: TauxTva[];
};

export type Bornes = { debut: string; fin: string };

export type TableauVentes = {
  periode: Bornes & Synthese;
  comparaison: Bornes & Synthese;
  jours: { jour: string; commandes: number; ttc_centimes: number; refusees: number }[];
};

export type TypePeriode = "jour" | "semaine" | "mois" | "choisie";

// Le jour de service change à 5h du matin à Genève (migration 20261114090000) : à 1h, on est encore la veille.
export function jourDeService(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(maintenant.getTime() - 5 * 3_600_000));
}

function decaler(jour: string, jours: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

function finDeMois(jour: string): string {
  const d = new Date(`${jour.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export type Demande = Bornes & { comparaison?: Bornes };

// Bornes d'une période autour d'un jour de référence. La semaine va du lundi au dimanche. Le mois se
// compare au mois civil précédent (la base, sans comparaison donnée, prendrait la même durée juste avant).
export function bornes(type: Exclude<TypePeriode, "choisie">, reference: string): Demande {
  if (type === "jour") return { debut: reference, fin: reference };
  if (type === "semaine") {
    const iso = (new Date(`${reference}T12:00:00Z`).getUTCDay() + 6) % 7;
    const debut = decaler(reference, -iso);
    return { debut, fin: decaler(debut, 6) };
  }
  const debut = `${reference.slice(0, 7)}-01`;
  const precedent = `${decaler(debut, -1).slice(0, 7)}-01`;
  return { debut, fin: finDeMois(debut), comparaison: { debut: precedent, fin: finDeMois(precedent) } };
}

const UN_AN = 366 * 86_400_000;

function bornesValides(debut: unknown, fin: unknown): Bornes | null {
  const d = dateValide(debut);
  const f = dateValide(fin);
  if (!d || !f || f < d || Date.parse(f) - Date.parse(d) >= UN_AN) return null;
  return { debut: d, fin: f };
}

// Lecture des paramètres de la route : ?periode=jour|semaine|mois&jour=AAAA-MM-JJ, ou ?debut=…&fin=…
// (période choisie) avec, si l'on veut, &comp_debut=…&comp_fin=…
export function lireDemande(q: URLSearchParams, aujourdhui: string = jourDeService()): Demande | null {
  const type = q.get("periode") ?? "jour";
  if (type === "jour" || type === "semaine" || type === "mois") {
    const ref = q.has("jour") ? dateValide(q.get("jour")) : aujourdhui;
    return ref ? bornes(type, ref) : null;
  }
  if (type !== "choisie") return null;
  const periode = bornesValides(q.get("debut"), q.get("fin"));
  if (!periode) return null;
  if (!q.has("comp_debut") && !q.has("comp_fin")) return periode;
  const comparaison = bornesValides(q.get("comp_debut"), q.get("comp_fin"));
  return comparaison ? { ...periode, comparaison } : null;
}

// Écart d'un chiffre avec la période de comparaison, en pour cent arrondi. null quand la comparaison vaut 0.
export function ecart(actuel: number, precedent: number): number | null {
  if (precedent === 0) return null;
  return Math.round(((actuel - precedent) / precedent) * 100);
}
