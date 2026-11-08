import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { ticketsDeCommande, type LigneTicket } from "@/lib/impression/ticket";
import { detailsTablette } from "@/lib/tablette-details";

// Impression à l'acceptation : une tâche par poste (pizza, cuisine) qui a des lignes, envoyée à la
// première imprimante active de ce poste. Sans imprimante, la tâche reste visible sur la tablette.

export async function imprimerCommande(
  commandeId: string,
  { reimpression = false, station }: { reimpression?: boolean; station?: "pizza" | "cuisine" } = {},
): Promise<number> {
  const [c, cat] = await Promise.all([commandeParId(commandeId), chargerCatalogue().catch(() => null)]);
  if (!c) return 0;
  const tickets = ticketsDeCommande(
    {
      ...c,
      lignes: c.lignes.map((l) => ({ nom: l.nom, qte: l.qte, station: l.station, details: detailsTablette(cat, l) })),
    },
    { accepteLe: new Date(), reimpression },
  ).filter((t) => !station || t.station === station);
  if (tickets.length === 0) return 0;
  return fonctionSql<number>("creer_taches_impression", { p_commande: commandeId, p: tickets, p_reimpression: reimpression });
}

export type EtatImpression = {
  imprimantes: { id: number; nom: string; station: "pizza" | "cuisine"; actif: boolean; liee: boolean; vue_le: string | null; en_ligne: boolean; statut_code: string | null }[];
  taches: {
    id: string;
    commande_id: string;
    station: "pizza" | "cuisine";
    etat: "en_attente" | "envoyee" | "imprimee" | "echec" | "sans_imprimante";
    reimpression: boolean;
    tentatives: number;
    derniere_erreur: string | null;
    cree_le: string;
    contenu: LigneTicket[];
  }[];
};

export function etatImpression(): Promise<EtatImpression> {
  return fonctionSql<EtatImpression>("etat_impression", {});
}
