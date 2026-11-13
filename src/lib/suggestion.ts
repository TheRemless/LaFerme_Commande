// Une seule suggestion au panier (P2 du carnet) : la boisson la plus commandée s'il n'y a pas de boisson,
// sinon le dessert le plus commandé s'il n'y a pas de dessert. Rien si le réglage est éteint, si le panier
// est vide ou si le plat demande un choix (il s'ajouterait incomplet). On l'ignore sans aucun geste.
import type { LignePlat } from "@/lib/carte";
import type { Catalogue, LignePanier } from "@/lib/panier";

export type DonneesPopulaires = { populaires_actifs: boolean; suggestion_active: boolean; tous: string[]; par_categorie: Record<string, string[]> };
export type Suggestion = { plat: LignePlat; categorie: "boissons" | "desserts" };

export function suggestionPanier(p: DonneesPopulaires | undefined, lignes: LignePanier[], catalogue: Catalogue, plats: LignePlat[]): Suggestion | null {
  if (!p?.suggestion_active || lignes.length === 0) return null;
  for (const categorie of ["boissons", "desserts"] as const) {
    if (lignes.some((l) => catalogue.plats[l.slug]?.categorie_slug === categorie)) continue;
    for (const slug of p.par_categorie[categorie] ?? []) {
      const info = catalogue.plats[slug];
      const plat = plats.find((x) => x.slug === slug);
      if (!info || !plat || info.rupture_motif || plat.rupture_motif) continue;
      if (info.groupes.some((g) => (catalogue.groupes[g]?.choix_min ?? 0) > 0)) continue;
      return { plat, categorie };
    }
  }
  return null;
}

// Plats les plus commandés en tête de la carte : au moins trois, sinon rien (C7).
export function platsPopulaires(p: DonneesPopulaires | undefined, plats: LignePlat[]): LignePlat[] {
  if (!p?.populaires_actifs) return [];
  const liste = p.tous.map((s) => plats.find((x) => x.slug === s)).filter((x): x is LignePlat => Boolean(x));
  return liste.length >= 3 ? liste : [];
}
