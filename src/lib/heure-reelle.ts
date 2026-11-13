import type { Charge, ConfigService, Mode } from "@/lib/service";

// Heure promise réaliste (vague 3, bo-operations). La base mesure la file de chaque poste
// (charge_cuisine, migration 20261130100000) et l'attente d'un livreur (charge_livraison, 20261130210000) ;
// config-service.ts ajoute l'allongement à toutes les heures annoncées comme le retard du soir. Ici : lecture
// prudente de la charge, fourchette annoncée au client et raison courte pour la tablette. Fonctions pures,
// mêmes résultats dans le navigateur et sur le serveur.
// Doc : docs/heure-reelle.md.

const entierPositif = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// Réponse de charge_livraison (version 2), ou null si elle est absente ou illisible (livraison non comptée).
function lireLivraison(brut: unknown): (NonNullable<Charge["livraison"]> & { allongement_minutes: number }) | null {
  if (!brut || typeof brut !== "object") return null;
  const l = brut as Record<string, unknown>;
  const livraisons = entierPositif(l.livraisons);
  const livreurs = entierPositif(l.livreurs);
  const attente = entierPositif(l.attente_minutes);
  const allongement = entierPositif(l.allongement_minutes);
  if (livraisons === null || livreurs === null || attente === null || allongement === null) return null;
  return { livraisons, livreurs, attente_minutes: attente, compte: l.compte === true, allongement_minutes: l.compte === true ? allongement : 0 };
}

// Réponses de charge_cuisine et de charge_livraison, ou null si la première est absente ou illisible (pas
// d'allongement). Sans la seconde, les livraisons suivent la cuisine seule.
export function lireCharge(brut: unknown, livraisonBrute?: unknown): Charge | null {
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
  const cuisineMin = Math.min(allongement, plafond);
  const l = lireLivraison(livraisonBrute);
  const charge: Charge = {
    pizza,
    cuisine,
    preparation_minutes: preparation,
    plafond_minutes: plafond,
    allongement_minutes: cuisineMin,
    // En livraison, le plus long des deux : le livreur attend la cuisine, ou la commande attend un livreur.
    allongement_livraison_minutes: Math.min(plafond, Math.max(cuisineMin, l?.allongement_minutes ?? 0)),
  };
  if (l) charge.livraison = { livraisons: l.livraisons, livreurs: l.livreurs, attente_minutes: l.attente_minutes, compte: l.compte };
  return charge;
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

// Raison courte pour la tablette et le back-office, ou null quand rien n'allonge les heures.
// Exemples : « Four : 22 pizzas en file, 42 min. Heures annoncées +25 min. »
// « Livraison : 1 livreur pour 4 livraisons, 60 min. Livraisons +40 min, retraits à l'heure habituelle. »
export function raisonCharge(charge: Charge | null | undefined): string | null {
  if (!charge) return null;
  const cuisine = charge.allongement_minutes;
  // Jamais moins que la cuisine : le livreur attend que la commande soit prête.
  const livraison = Math.max(cuisine, charge.allongement_livraison_minutes ?? cuisine);
  if (cuisine <= 0 && livraison <= 0) return null;
  const morceaux: string[] = [];
  const dire = (nom: string, unite: [string, string], p: Charge["pizza"]) => {
    if (p.compte && p.file_minutes > charge.preparation_minutes) {
      morceaux.push(`${nom} : ${p.articles} ${p.articles > 1 ? unite[1] : unite[0]} en file, ${p.file_minutes} min.`);
    }
  };
  dire("Four", ["pizza", "pizzas"], charge.pizza);
  dire("Cuisine", ["plat", "plats"], charge.cuisine);
  const l = charge.livraison;
  if (l?.compte && l.attente_minutes > charge.preparation_minutes) {
    morceaux.push(
      `Livraison : ${l.livreurs} livreur${l.livreurs > 1 ? "s" : ""} pour ${l.livraisons} livraison${l.livraisons > 1 ? "s" : ""}, ${l.attente_minutes} min.`,
    );
  }
  const plus = (m: number) => `+${m} min${m >= charge.plafond_minutes ? " (au plus)" : ""}`;
  const effet =
    livraison === cuisine
      ? `Heures annoncées ${plus(cuisine)}.`
      : `Livraisons ${plus(livraison)}, retraits ${cuisine > 0 ? plus(cuisine) : "à l'heure habituelle"}.`;
  return `${morceaux.join(" ")} ${effet}`.trim();
}
