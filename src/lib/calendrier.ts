import { ajouterJours, fermeturePour, jourIso, servicesDu, type ConfigService, type Horaire } from "@/lib/service";

// Calendrier du back-office (vague 3, bo-operations) : jours fériés genevois proposés, ce que verra le client
// chaque jour, et ce qui le décide. Fonctions pures. Doc : docs/calendrier.md.

// Jours fériés du canton de Genève, loi sur les jours fériés (rsGE J 1 45), art. 1 al. 1, lue le 13.11.2026
// sur silgeneve.ch. Le report d'un férié tombé un dimanche (art. 1 al. 2) ne vise que les entreprises hors loi
// fédérale sur le travail : pas compté ici. Ce sont des propositions : rien ne ferme sans le gérant.
export type Ferie = { date: string; nom: string };

// Dimanche de Pâques (calendrier grégorien, algorithme dit « anonyme »).
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

export function feriesGeneve(annee: number): Ferie[] {
  const p = paques(annee);
  // Jeûne genevois : le jeudi qui suit le premier dimanche de septembre.
  let dimanche = `${annee}-09-01`;
  while (jourIso(dimanche) !== 7) dimanche = ajouterJours(dimanche, 1);
  return [
    { date: `${annee}-01-01`, nom: "Nouvel An" },
    { date: ajouterJours(p, -2), nom: "Vendredi saint" },
    { date: ajouterJours(p, 1), nom: "Lundi de Pâques" },
    { date: ajouterJours(p, 39), nom: "Ascension" },
    { date: ajouterJours(p, 50), nom: "Lundi de Pentecôte" },
    { date: `${annee}-08-01`, nom: "Fête nationale" },
    { date: ajouterJours(dimanche, 4), nom: "Jeûne genevois" },
    { date: `${annee}-12-25`, nom: "Noël" },
    { date: `${annee}-12-31`, nom: "Restauration de la République" },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

export type ServiceJour = {
  service: Horaire["service"];
  // ouvert : le client peut commander pour ce service ; ferme : il ne le voit pas.
  ouvert: boolean;
  premiere_heure?: string;
  derniere_heure?: string;
  // Ce qui décide : horaires habituels, ouverture exceptionnelle, fermeture (avec motif), ou rien ce jour-là.
  source: "habituel" | "ouverture" | "fermeture" | "pas-de-service";
  motif?: string;
};
export type JourCalendrier = { date: string; jour: number; ferie: string | null; services: ServiceJour[] };

const hm = (t: string) => t.slice(0, 5);

// Un jour vu par le client : quels services ouverts, et pourquoi.
export function jourCalendrier(config: ConfigService, date: string, feries: Ferie[] = []): JourCalendrier {
  const jour = jourIso(date);
  const ouverts = servicesDu(config, date);
  const habituels = config.horaires.filter((h) => h.jour === jour);
  const exceptionnelles = (config.ouvertures ?? []).filter((o) => o.jour === date);
  const fermetureJour = fermeturePour(config, date);
  const services: ServiceJour[] = (["midi", "soir"] as const).map((service) => {
    const ouvert = ouverts.find((h) => h.service === service);
    if (ouvert) {
      return {
        service,
        ouvert: true,
        premiere_heure: hm(ouvert.premiere_heure),
        derniere_heure: hm(ouvert.derniere_heure),
        source: exceptionnelles.some((o) => o.service === service) ? "ouverture" : "habituel",
      };
    }
    const fermeture = fermetureJour ?? config.fermetures.find((f) => f.service === service && f.debut <= date && date <= f.fin);
    if (fermeture && (habituels.some((h) => h.service === service) || exceptionnelles.some((o) => o.service === service))) {
      return { service, ouvert: false, source: "fermeture", motif: fermeture.motif };
    }
    return { service, ouvert: false, source: "pas-de-service" };
  });
  return { date, jour, ferie: feries.find((f) => f.date === date)?.nom ?? null, services };
}

// Jours de debut à fin (bornes comprises), avec les fériés des années touchées.
export function calendrier(config: ConfigService, debut: string, fin: string): JourCalendrier[] {
  const annees = new Set([Number(debut.slice(0, 4)), Number(fin.slice(0, 4))]);
  const feries = [...annees].flatMap(feriesGeneve);
  const jours: JourCalendrier[] = [];
  for (let d = debut; d <= fin; d = ajouterJours(d, 1)) jours.push(jourCalendrier(config, d, feries));
  return jours;
}

// Fériés à venir où le restaurant serait ouvert : à confirmer ou à fermer par le gérant (proposition).
export function feriesAConfirmer(config: ConfigService, debut: string, fin: string): (Ferie & { services: ServiceJour["service"][] })[] {
  return calendrier(config, debut, fin)
    .filter((j) => j.ferie && j.services.some((s) => s.ouvert))
    .map((j) => ({ date: j.date, nom: j.ferie!, services: j.services.filter((s) => s.ouvert).map((s) => s.service) }));
}
