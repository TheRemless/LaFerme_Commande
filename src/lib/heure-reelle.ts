import type { Charge, ConfigService, Mode } from "@/lib/service";

// Heure promise réaliste (vague 3, bo-operations). La base mesure la file de chaque poste
// (charge_cuisine, migration 20261130100000) ; config-service.ts ajoute l'allongement à toutes les heures
// annoncées comme le retard du soir. Ici : lecture prudente de la charge, fourchette annoncée au client et
// raison courte pour la tablette. Fonctions pures, mêmes résultats dans le navigateur et sur le serveur.
// Doc : docs/heure-reelle.md.

const entierPositif = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// Réponse de charge_cuisine, ou null si elle est absente ou illisible (pas d'allongement).
export function lireCharge(brut: unknown): Charge | null {
  if (!brut || typeof brut !== "object") return null;
  const c = brut as Record<string, unknown>;
  const poste = (v: unknown) => {
    if (!v || typeof v !== "object") return null;
    const p = v as Record<string, unknown>;
    const articles = entierPositif(p.articles);
    const file = entierPositif(p.file_minutes);
    return articles === null || file === null ? null : { articles, file_minutes: file, compte: p.compte === true };
  };
  const pizza = poste(c.pizza);
  const cuisine = poste(c.cuisine);
  const preparation = entierPositif(c.preparation_minutes);
  const plafond = entierPositif(c.plafond_minutes);
  const allongement = entierPositif(c.allongement_minutes);
  if (!pizza || !cuisine || preparation === null || plafond === null || allongement === null) return null;
  // Le plafond fait foi même si la base en renvoyait plus.
  return { pizza, cuisine, preparation_minutes: preparation, plafond_minutes: plafond, allongement_minutes: Math.min(allongement, plafond) };
}

export const FOURCHETTE_DEFAUT = { livraison: 15, retrait: 10 } as const;

// Largeur de la fourchette par mode (réglages fourchette_livraison_minutes, fourchette_retrait_minutes).
export function lireFourchette(reglages: { cle: string; valeur: unknown }[]): { livraison: number; retrait: number } {
  const lire = (mode: Mode) => {
    const v = Number(reglages.find((r) => r.cle === `fourchette_${mode}_minutes`)?.valeur);
    return Number.isInteger(v) && v >= 0 && v <= 60 ? v : FOURCHETTE_DEFAUT[mode];
  };
  return { livraison: lire("livraison"), retrait: lire("retrait") };
}

// « De 19h35 à 19h50 » autour de l'heure promise (minutes depuis minuit), arrondie aux 5 minutes.
// Largeur 0 : une seule heure (basse = haute = heure promise).
export function fourchette(config: Pick<ConfigService, "reglages">, mode: Mode, promise: number): { basse: number; haute: number } {
  const largeur = config.reglages.fourchette?.[mode] ?? FOURCHETTE_DEFAUT[mode];
  if (largeur === 0) return { basse: promise, haute: promise };
  const basse = Math.round((promise - largeur / 2) / 5) * 5;
  return { basse, haute: basse + largeur };
}

// Raison courte pour la tablette et le back-office, ou null quand la file n'allonge rien.
// Exemple : « Four : 22 pizzas en file, 42 min. Heures annoncées +25 min. »
export function raisonCharge(charge: Charge | null | undefined): string | null {
  if (!charge || charge.allongement_minutes <= 0) return null;
  const morceaux: string[] = [];
  const dire = (nom: string, unite: [string, string], p: Charge["pizza"]) => {
    if (p.compte && p.file_minutes > charge.preparation_minutes) {
      morceaux.push(`${nom} : ${p.articles} ${p.articles > 1 ? unite[1] : unite[0]} en file, ${p.file_minutes} min.`);
    }
  };
  dire("Four", ["pizza", "pizzas"], charge.pizza);
  dire("Cuisine", ["plat", "plats"], charge.cuisine);
  const plafond = charge.allongement_minutes >= charge.plafond_minutes ? " (au plus)" : "";
  return `${morceaux.join(" ")} Heures annoncées +${charge.allongement_minutes} min${plafond}.`.trim();
}
