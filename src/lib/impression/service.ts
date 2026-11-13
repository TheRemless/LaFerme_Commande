import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import { ticketAnnulation, ticketsDeCommande, type LigneTicket } from "@/lib/impression/ticket";
import { detailsTablette } from "@/lib/tablette-details";

// Une tâche par poste (pizza, cuisine) qui a des lignes, envoyée à la première imprimante active de ce poste.
// Sans imprimante, la tâche reste visible sur la tablette. Les premiers tickets sortent à l'acceptation, ou
// pour une commande à l'avance à l'heure promise moins le délai de son mode, créés par la surveillance
// (SS-11) : premiers_tickets ne les crée qu'une fois. Une réimpression en crée toujours de nouveaux.

export async function imprimerCommande(
  commandeId: string,
  { reimpression = false, station }: { reimpression?: boolean; station?: "pizza" | "cuisine" } = {},
): Promise<number> {
  const [c, cat] = await Promise.all([commandeParId(commandeId), chargerCatalogue().catch(() => null)]);
  if (!c) return 0;
  const tickets = ticketsDeCommande(
    {
      ...c,
      lignes: c.lignes.map((l) => ({ nom: l.nom, qte: l.qte, station: l.station, details: detailsTablette(cat, l), pour: (l as { pour?: string }).pour })),
    },
    // Ticket d'une commande à l'avance imprimé le jour J : il dit quand elle a été acceptée, pas quand il sort.
    { accepteLe: c.accepte_le ?? new Date(), reimpression },
  ).filter((t) => !station || t.station === station);
  if (tickets.length === 0) return 0;
  if (!reimpression) return fonctionSql<number>("premiers_tickets", { p_commande: commandeId, p: tickets });
  return fonctionSql<number>("creer_taches_impression", { p_commande: commandeId, p: tickets, p_reimpression: true });
}

// Tour de surveillance : les commandes acceptées dont l'heure d'impression est arrivée. Une commande qui
// échoue (base lente) garde tickets_le vide et repasse au tour suivant. Renvoie le nombre de commandes imprimées.
export async function imprimerCommandesDues(): Promise<number> {
  const ids = await fonctionSql<string[]>("commandes_a_imprimer", {});
  let n = 0;
  for (const id of ids ?? []) {
    const crees = await imprimerCommande(id).catch((e) => {
      console.error(`Tickets à l'avance non créés pour ${id} : ${e instanceof Error ? e.message : e}`);
      return 0;
    });
    if (crees > 0) n += 1;
  }
  return n;
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
    commande_id: string | null; // null : ticket de test (essai)
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
