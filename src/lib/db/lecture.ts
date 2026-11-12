import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baseLocale, lireCommeVisiteur } from "@/lib/db/locale";

// Tables et vues lisibles par un visiteur. Liste fermée : le nom finit dans une requête SQL locale.
const LISIBLES = [
  "carte_publique",
  "plat_groupes_publics",
  "options_publiques",
  "retraits_publics",
  "zones_livraison",
  "zone_npa",
  "horaires",
  "fermetures",
  "reglages",
  "ouvertures",
] as const;
export type Lisible = (typeof LISIBLES)[number];
export type SourceDonnees = "supabase" | "locale";

function configSupabase(): { url: string; cle: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (Boolean(url) !== Boolean(cle)) {
    // Une seule des deux variables : configuration cassée, on le dit au lieu de servir la base embarquée.
    throw new Error("Configuration Supabase incomplète : il faut NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  return url && cle ? { url, cle } : null;
}

export function sourceDonnees(): SourceDonnees {
  return configSupabase() ? "supabase" : "locale";
}

// Un seul client par instance de fonction : ses connexions restent ouvertes d'une requête à l'autre.
let lecteur: { url: string; cle: string; client: SupabaseClient } | null = null;

// Lit une table publique avec les droits d'un visiteur, depuis Supabase ou la base embarquée.
export async function lirePublic<T>(nom: Lisible): Promise<T[]> {
  if (!LISIBLES.includes(nom)) throw new Error(`Lecture non autorisée : ${nom}`);
  const config = configSupabase();
  if (config) {
    if (lecteur?.url !== config.url || lecteur.cle !== config.cle) {
      lecteur = { ...config, client: createClient(config.url, config.cle, { auth: { persistSession: false } }) };
    }
    const supabase = lecteur.client;
    const { data, error } = await supabase.from(nom).select("*");
    if (error) throw new Error(`Lecture de ${nom} impossible : ${error.message}`);
    return data as T[];
  }
  // Sans Supabase, la base embarquée sert au développement, aux tests et aux previews Netlify,
  // jamais à la production. En local, un build de production l'exige explicitement (BASE_LOCALE).
  const contexte = process.env.CONTEXTE_DEPLOIEMENT;
  if (contexte === "production" || (contexte === "local" && process.env.NODE_ENV === "production" && !process.env.BASE_LOCALE)) {
    throw new Error("Variables Supabase manquantes : la base embarquée n'est pas autorisée ici.");
  }
  return lireCommeVisiteur<T>(await baseLocale(), `select * from ${nom}`);
}
