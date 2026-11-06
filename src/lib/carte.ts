import "server-only";
import { createClient } from "@supabase/supabase-js";
import { baseLocale, lireCommeVisiteur } from "@/lib/db/locale";

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
};

export type Categorie = { slug: string; nom: string; plats: LignePlat[] };

export type SourceCarte = "supabase" | "locale";

async function lireLignes(): Promise<{ lignes: LignePlat[]; source: SourceCarte }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (Boolean(url) !== Boolean(cle)) {
    // Une seule des deux variables : configuration cassée, on le dit au lieu de servir la base embarquée.
    throw new Error("Configuration Supabase incomplète : il faut NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  if (url && cle) {
    const supabase = createClient(url, cle, { auth: { persistSession: false } });
    const { data, error } = await supabase.from("carte_publique").select("*");
    if (error) throw new Error(`Lecture de la carte impossible : ${error.message}`);
    return { lignes: data as LignePlat[], source: "supabase" };
  }
  // Sans Supabase, la base embarquée sert au développement, aux tests et aux previews Netlify,
  // jamais à la production. En local, un build de production l'exige explicitement (BASE_LOCALE).
  const contexte = process.env.CONTEXTE_DEPLOIEMENT;
  if (contexte === "production" || (contexte === "local" && process.env.NODE_ENV === "production" && !process.env.BASE_LOCALE)) {
    throw new Error("Variables Supabase manquantes : la base embarquée n'est pas autorisée ici.");
  }
  return { lignes: await lireCommeVisiteur<LignePlat>(await baseLocale(), "select * from carte_publique"), source: "locale" };
}

export function regrouperParCategorie(lignes: LignePlat[]): Categorie[] {
  const parSlug = new Map<string, Categorie & { ordre: number }>();
  for (const l of lignes) {
    let c = parSlug.get(l.categorie_slug);
    if (!c) {
      c = { slug: l.categorie_slug, nom: l.categorie_nom, ordre: l.categorie_ordre, plats: [] };
      parSlug.set(l.categorie_slug, c);
    }
    c.plats.push(l);
  }
  return [...parSlug.values()]
    .sort((a, b) => a.ordre - b.ordre)
    .map(({ slug, nom, plats }) => ({ slug, nom, plats: plats.sort((a, b) => a.ordre - b.ordre) }));
}

export async function chargerCarte(): Promise<{ categories: Categorie[]; source: SourceCarte }> {
  const { lignes, source } = await lireLignes();
  return { categories: regrouperParCategorie(lignes), source };
}
