import "server-only";
import { unstable_cache } from "next/cache";
import type { LignePlat } from "@/lib/carte";
import { lirePublic } from "@/lib/db/lecture";
import type { Catalogue, GroupeCatalogue } from "@/lib/panier";

type LigneGroupe = { plat_slug: string; groupe_slug: string; ordre: number };
type LigneOption = {
  groupe_slug: string;
  groupe_nom: string;
  choix_min: number;
  choix_max: number;
  nom: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  ordre: number;
};
type LigneRetrait = { plat_slug: string; nom: string; a_valider: boolean; ordre: number };
type LigneReglage = { cle: string; valeur: unknown };

type DonneesCarte = {
  plats: LignePlat[];
  liens: LigneGroupe[];
  options: LigneOption[];
  retraits: LigneRetrait[];
  reglages: LigneReglage[];
};

// Lignes brutes de la carte, lues en base avec les droits d'un visiteur. La page carte et le
// catalogue (fiche plat, calcul du panier) partagent cette seule lecture.
async function lireDonneesCarte(): Promise<DonneesCarte> {
  const [plats, liens, options, retraits, reglages] = await Promise.all([
    lirePublic<LignePlat>("carte_publique"),
    lirePublic<LigneGroupe>("plat_groupes_publics"),
    lirePublic<LigneOption>("options_publiques"),
    lirePublic<LigneRetrait>("retraits_publics"),
    lirePublic<LigneReglage>("reglages"),
  ]);
  return { plats, liens, options, retraits, reglages };
}

// Une minute de cache : un prix ou une rupture changés dans le back-office s'appliquent vite,
// et le back-office comme la tablette vident le cache aussitôt (rafraichirCaches).
export const chargerDonneesCarte = process.env.VITEST
  ? lireDonneesCarte
  : unstable_cache(lireDonneesCarte, ["donnees-carte"], { revalidate: 60, tags: ["catalogue"] });

export async function chargerCatalogue(): Promise<Catalogue> {
  return construireCatalogue(await chargerDonneesCarte());
}

function construireCatalogue({ plats, liens, options, retraits, reglages }: DonneesCarte): Catalogue {
  const taux = Number(reglages.find((r) => r.cle === "tva_emporter_pourcent")?.valeur);
  if (!Number.isFinite(taux)) throw new Error("Réglage manquant : tva_emporter_pourcent");

  const groupes: Record<string, GroupeCatalogue> = {};
  for (const o of [...options].sort((a, b) => a.ordre - b.ordre)) {
    groupes[o.groupe_slug] ??= { slug: o.groupe_slug, nom: o.groupe_nom, choix_min: o.choix_min, choix_max: o.choix_max, options: [] };
    groupes[o.groupe_slug].options.push({ nom: o.nom, prix_centimes: o.prix_centimes, prix_a_valider: o.prix_a_valider });
  }
  const catalogue: Catalogue = { plats: {}, groupes, tauxTvaPourcent: taux };
  for (const p of plats) {
    catalogue.plats[p.slug] = {
      slug: p.slug,
      nom: p.nom,
      categorie_slug: p.categorie_slug,
      prix_centimes: p.prix_centimes,
      prix_a_valider: p.prix_a_valider,
      station: p.station,
      rupture_motif: p.rupture_motif,
      groupes: liens
        .filter((l) => l.plat_slug === p.slug)
        .sort((a, b) => a.ordre - b.ordre)
        .map((l) => l.groupe_slug),
      retraits: retraits
        .filter((r) => r.plat_slug === p.slug)
        .sort((a, b) => a.ordre - b.ordre)
        .map((r) => ({ nom: r.nom, a_valider: r.a_valider })),
    };
  }
  return catalogue;
}
