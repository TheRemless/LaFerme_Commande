// Recherche globale du back-office (⌘K, vague 3, bo-socle). Elle ne refait aucune requête : elle demande
// cinq résultats aux listes qui existent déjà (commandes et clients de bo-commandes, catalogue de la carte).
// La recherche part en POST : un nom ou un téléphone n'apparaît jamais dans une adresse.
import { chargerCatalogue } from "@/lib/catalogue";
import { fonctionSql } from "@/lib/db/serveur";

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

type LigneCommande = { id: string; numero: number; client_prenom: string; client_nom: string; mode: "livraison" | "retrait"; statut: string; heure_prevue: string | null; cree_le: string; total_centimes: number };
type LigneClient = { email: string; prenom: string | null; nom: string | null; telephone: string | null; commandes: number };

const sur = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function rechercher(q: string): Promise<ResultatsRecherche> {
  const [commandes, clients, catalogue] = await Promise.all([
    sur(fonctionSql<{ lignes: LigneCommande[] }>("liste_commandes_gestion", { p: { recherche: q, tri: "recent", page: 1, par_page: MAX_PAR_GROUPE } })),
    // Les chiffres seuls (numéro de commande) ne cherchent pas de client : un téléphone a au moins six chiffres.
    /^\d{1,5}$/.test(q) ? Promise.resolve({ lignes: [] as LigneClient[] }) : sur(fonctionSql<{ lignes: LigneClient[] }>("clients_gestion", { p: { recherche: q, page: 1, par_page: 10 } })),
    sur(chargerCatalogue()),
  ]);
  const n = normaliser(q);
  return {
    commandes:
      commandes?.lignes.slice(0, MAX_PAR_GROUPE).map((c) => ({
        id: c.id,
        numero: c.numero,
        client: `${c.client_prenom} ${c.client_nom}`.trim(),
        mode: c.mode,
        statut: c.statut,
        quand: c.heure_prevue ?? c.cree_le,
        total_centimes: c.total_centimes,
      })) ?? null,
    clients:
      clients?.lignes.slice(0, MAX_PAR_GROUPE).map((c) => ({ email: c.email, nom: [c.prenom, c.nom].filter(Boolean).join(" ") || c.email, telephone: c.telephone, commandes: c.commandes })) ?? null,
    plats: catalogue
      ? Object.values(catalogue.plats)
          .filter((p) => normaliser(p.nom).includes(n))
          .slice(0, MAX_PAR_GROUPE)
          .map((p) => ({ slug: p.slug, nom: p.nom, rupture: Boolean(p.rupture_motif) }))
      : null,
  };
}
