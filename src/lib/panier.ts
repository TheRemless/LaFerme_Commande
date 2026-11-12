// Panier : contenu choisi par le client et calcul des montants. Fonction pure, la même dans le
// navigateur (affichage immédiat) et sur le serveur (/api/panier), qui seul fait foi.
// Tous les prix viennent du catalogue lu en base : aucun montant n'est écrit ici.

export type OptionCatalogue = { nom: string; prix_centimes: number; prix_a_valider: boolean; rupture?: boolean };
export type GroupeCatalogue = { slug: string; nom: string; choix_min: number; choix_max: number; options: OptionCatalogue[] };
export type RetraitCatalogue = { nom: string; a_valider: boolean };
export type PlatCatalogue = {
  slug: string;
  nom: string;
  categorie_slug: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  station: "pizza" | "cuisine";
  rupture_motif: string | null;
  groupes: string[];
  retraits: RetraitCatalogue[];
};
export type Catalogue = {
  plats: Record<string, PlatCatalogue>;
  groupes: Record<string, GroupeCatalogue>;
  tauxTvaPourcent: number;
};

export type LignePanier = {
  slug: string;
  qte: number;
  // Options choisies par groupe (slug du groupe → noms des options).
  choix: Record<string, string[]>;
  retraits: string[];
  note: string;
};

export type LigneCalculee = LignePanier & { nom: string; unitaire_centimes: number; total_centimes: number; erreur?: string };

export type Livraison = { frais_centimes: number; minimum_centimes: number };

export type Totaux = {
  lignes: LigneCalculee[];
  sous_total_centimes: number;
  frais_centimes: number;
  total_centimes: number;
  tva_centimes: number;
  manque_minimum_centimes: number;
  // Tous les plats sortent du poste pizza : commande possible jusqu'à la dernière commande des pizzas.
  pizzas_seulement: boolean;
  prix_a_valider: boolean;
  valide: boolean;
};

export const LIMITES = { lignes: 30, quantite: 20, note: 80 } as const;

// Lecture sûre : un slug comme « __proto__ » ou « toString » ne doit pas tomber sur Object.prototype.
export function platDe(cat: Catalogue, slug: string): PlatCatalogue | undefined {
  return Object.hasOwn(cat.plats, slug) ? cat.plats[slug] : undefined;
}
function groupeDe(cat: Catalogue, slug: string): GroupeCatalogue | undefined {
  return Object.hasOwn(cat.groupes, slug) ? cat.groupes[slug] : undefined;
}

function erreurLigne(cat: Catalogue, l: LignePanier): string | undefined {
  const plat = platDe(cat, l.slug);
  if (!plat) return "Ce plat n'est plus à la carte.";
  if (plat.rupture_motif) return plat.rupture_motif;
  if (!Number.isInteger(l.qte) || l.qte < 1 || l.qte > LIMITES.quantite) return "Quantité invalide.";
  if (l.note.length > LIMITES.note) return "Note trop longue.";
  for (const cle of Object.keys(l.choix)) if (!plat.groupes.includes(cle)) return "Option inconnue pour ce plat.";
  for (const g of plat.groupes.map((s) => groupeDe(cat, s))) {
    if (!g) return "Option inconnue pour ce plat.";
    const choisis = l.choix[g.slug] ?? [];
    if (new Set(choisis).size !== choisis.length) return "Option choisie deux fois.";
    if (choisis.some((n) => !g.options.some((o) => o.nom === n))) return "Option inconnue pour ce plat.";
    const epuise = choisis.find((n) => g.options.find((o) => o.nom === n)?.rupture);
    if (epuise) return `${epuise} : épuisé pour aujourd'hui.`;
    if (choisis.length < g.choix_min) return `Choisissez vos ${g.nom.toLowerCase()}.`;
    if (choisis.length > g.choix_max) return "Trop d'options choisies.";
  }
  if (new Set(l.retraits).size !== l.retraits.length) return "Ingrédient retiré deux fois.";
  if (l.retraits.some((r) => !plat.retraits.some((x) => x.nom === r))) return "Ingrédient inconnu pour ce plat.";
  return undefined;
}

export function prixUnitaire(cat: Catalogue, l: LignePanier): number {
  const plat = platDe(cat, l.slug);
  if (!plat) return 0;
  let prix = plat.prix_centimes;
  for (const [g, noms] of Object.entries(l.choix)) {
    for (const n of noms) prix += groupeDe(cat, g)?.options.find((o) => o.nom === n)?.prix_centimes ?? 0;
  }
  return prix;
}

export function calculerPanier(cat: Catalogue, lignes: LignePanier[], livraison: Livraison | null): Totaux {
  const calculees: LigneCalculee[] = lignes.slice(0, LIMITES.lignes).map((l) => {
    const erreur = erreurLigne(cat, l);
    const unitaire = prixUnitaire(cat, l);
    return { ...l, nom: platDe(cat, l.slug)?.nom ?? l.slug, unitaire_centimes: unitaire, total_centimes: erreur ? 0 : unitaire * l.qte, erreur };
  });
  const sousTotal = calculees.reduce((s, l) => s + l.total_centimes, 0);
  const frais = livraison && calculees.length ? livraison.frais_centimes : 0;
  const total = sousTotal + frais;
  const taux = cat.tauxTvaPourcent;
  const plats = calculees.map((l) => platDe(cat, l.slug)).filter((p): p is PlatCatalogue => p !== undefined);
  const optionsAValider = calculees.some((l) =>
    Object.entries(l.choix).some(([g, noms]) => noms.some((n) => groupeDe(cat, g)?.options.find((o) => o.nom === n)?.prix_a_valider)),
  );
  const manque = livraison ? Math.max(0, livraison.minimum_centimes - sousTotal) : 0;
  return {
    lignes: calculees,
    sous_total_centimes: sousTotal,
    frais_centimes: frais,
    total_centimes: total,
    // TVA comprise dans le prix : part = total × taux / (100 + taux).
    tva_centimes: Math.round((total * taux) / (100 + taux)),
    manque_minimum_centimes: manque,
    pizzas_seulement: plats.length > 0 && plats.every((p) => p.station === "pizza"),
    prix_a_valider: plats.some((p) => p.prix_a_valider) || optionsAValider,
    valide: calculees.length > 0 && lignes.length <= LIMITES.lignes && calculees.every((l) => !l.erreur) && manque === 0,
  };
}

// Deux lignes identiques (même plat, mêmes options, même note) se fusionnent.
export function memeLigne(a: LignePanier, b: LignePanier): boolean {
  const cle = (l: LignePanier) =>
    JSON.stringify([l.slug, Object.entries(l.choix).map(([g, n]) => [g, [...n].sort()]).sort(), [...l.retraits].sort(), l.note.trim()]);
  return cle(a) === cle(b);
}
