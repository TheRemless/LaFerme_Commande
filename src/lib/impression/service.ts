import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import { ticketAnnulation, ticketsDeCommande, type LigneTicket } from "@/lib/impression/ticket";
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

// Commande annulée après acceptation : ses tickets encore en file n'en sortent plus, et chaque poste qui a
// déjà le sien reçoit un ticket « ANNULÉE » (SS-03). Renvoie le nombre de tickets d'annulation.
export async function annulerImpression(c: Commande): Promise<number> {
  const postes = await fonctionSql<("pizza" | "cuisine")[]>("annuler_impression", { p_commande: c.id });
  if (!postes?.length) return 0;
  const tickets = postes.map((station) => ({ station, contenu: ticketAnnulation(c, station) }));
  return fonctionSql<number>("creer_taches_impression", { p_commande: c.id, p: tickets, p_reimpression: false });
}

export type EtatImpression = {
  imprimantes: { id: number; nom: string; station: "pizza" | "cuisine"; actif: boolean; liee: boolean; vue_le: string | null; en_ligne: boolean; statut_code: string | null }[];
  taches: {
    id: string;
    commande_id: string;
    station: "pizza" | "cuisine";
    etat: "en_attente" | "envoyee" | "imprimee" | "echec" | "sans_imprimante" | "annulee";
    reimpression: boolean;
    tentatives: number;
    derniere_erreur: string | null;
    cree_le: string;
  }[];
};

export function ticketsCommande(commandeId: string): Promise<{ station: "pizza" | "cuisine"; contenu: LigneTicket[] }[]> {
  return fonctionSql("tickets_commande", { p_commande: commandeId });
}

export function etatImpression(): Promise<EtatImpression> {
  return fonctionSql<EtatImpression>("etat_impression", {});
}
