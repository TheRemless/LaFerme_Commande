// Recherche globale du back-office : la partie pure, utilisable côté navigateur et côté serveur.
export const MAX_PAR_GROUPE = 5;

export type ResultatCommande = { id: string; numero: number; client: string; mode: "livraison" | "retrait"; statut: string; quand: string; total_centimes: number };
export type ResultatClient = { email: string; nom: string; telephone: string | null; commandes: number };
export type ResultatPlat = { slug: string; nom: string; rupture: boolean };
export type ResultatsRecherche = { commandes: ResultatCommande[] | null; clients: ResultatClient[] | null; plats: ResultatPlat[] | null };

/** Texte cherché : espaces réduits, 60 caractères au plus ; null en dessous de deux caractères. */
export function texteRecherche(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = v.trim().replace(/\s+/g, " ").slice(0, 60);
  return q.length >= 2 || /^\d+$/.test(q) ? q : null;
}

/** Comparaison sans accents ni majuscules, comme la recherche de la carte côté client. */
export function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

