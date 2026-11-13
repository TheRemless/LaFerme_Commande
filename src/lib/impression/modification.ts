import "server-only";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { posteDuSac, ticketModification, type Changement, type CommandePourTicket } from "@/lib/impression/ticket";

// Ticket « MODIFIÉE » (vague 3, contrat avec bo-commandes, #65) : appelé par modifierCommande après
// modifier_commande, seulement si quelque chose a changé. Un seul ticket, au poste qui fait le sac. Rien si les
// premiers tickets ne sont pas encore sortis (ils porteront les nouvelles valeurs) ni pour une commande finie.
// Renvoie le nombre de tickets créés. Pas de migration : creer_taches_impression, comme une réimpression.

const EN_COURS = new Set(["acceptee", "en_preparation", "prete", "partie"]);

export type { Changement };

export async function imprimerModification(commandeId: string, changements: Changement[]): Promise<number> {
  const utiles = changements.filter((c) => c.avant !== c.apres);
  if (utiles.length === 0) return 0;
  const c = (await commandeParId(commandeId)) as (CommandePourTicket & { statut: string; tickets_le?: string | null }) | null;
  if (!c || !c.tickets_le || !EN_COURS.has(c.statut)) return 0;
  const station = posteDuSac(c);
  return fonctionSql<number>("creer_taches_impression", { p_commande: commandeId, p: [{ station, contenu: ticketModification(c, utiles) }], p_reimpression: true });
}
