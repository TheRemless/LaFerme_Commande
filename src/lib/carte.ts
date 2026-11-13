import "server-only";
import { chargerDonneesCarte } from "@/lib/catalogue";
import { sourceDonnees, type SourceDonnees } from "@/lib/db/lecture";
import { PHOTOS_RETIREES } from "@/lib/photos";
import { dateDe } from "@/lib/plat-du-jour";

// Une ligne de la vue carte_publique (supabase/migrations/20261105120000_carte.sql).
export type LignePlat = {
  categorie_slug: string;
  categorie_nom: string;
  categorie_ordre: number;
  slug: string;
  nom: string;
  description: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  photo: string | null;
  ordre: number;
  rupture_motif: string | null;
  provenance: string | null;
  provenances_a_fournir: string[];
  allergenes: string | null;
  a_options: boolean;
  station: "pizza" | "cuisine";
  // Plat du jour : date (lue en texte ou en Date selon la base) et service. Null pour la carte.
  jour?: string | null;
  jour_service?: "midi" | "soir" | "journee" | null;
  // Disponibilités et rupture planifiée (migration 20261130100000). Absentes avant la migration.
  dispo_service?: string | null;
  dispo_mode?: string | null;
  dispo_jours?: number[] | null;
  rupture_jusqu_au?: string | Date | null;
};

export type Categorie = { slug: string; nom: string; plats: LignePlat[] };

export function regrouperParCategorie(lignes: LignePlat[]): Categorie[] {
  const parSlug = new Map<string, Categorie & { ordre: number }>();
  for (const l of lignes) {
    let c = parSlug.get(l.categorie_slug);
    if (!c) {
      c = { slug: l.categorie_slug, nom: l.categorie_nom, ordre: l.categorie_ordre, plats: [] };
      parSlug.set(l.categorie_slug, c);
    }
    // Une photo retirée (salade mêlée, hors shooting) peut rester inscrite en base : on ne l'affiche pas.
    c.plats.push({
      ...l,
      photo: l.photo && !PHOTOS_RETIREES.includes(l.photo) ? l.photo : null,
      jour: l.jour ? dateDe(l.jour as string | Date) : null,
    });
  }
  return [...parSlug.values()]
    .sort((a, b) => a.ordre - b.ordre)
    .map(({ slug, nom, plats }) => ({ slug, nom, plats: plats.sort((a, b) => a.ordre - b.ordre) }));
}

// Les plats viennent de la lecture en cache partagée avec le catalogue (src/lib/catalogue.ts).
export async function chargerCarte(): Promise<{ categories: Categorie[]; source: SourceDonnees }> {
  const { plats } = await chargerDonneesCarte();
  return { categories: regrouperParCategorie(plats), source: sourceDonnees() };
}
