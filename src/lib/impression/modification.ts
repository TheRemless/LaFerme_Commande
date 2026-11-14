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
  const du = await montantDu(commandeId, c).catch(() => undefined);
  return fonctionSql<number>("creer_taches_impression", { p_commande: commandeId, p: [{ station, contenu: ticketModification(c, utiles, new Date(), du) }], p_reimpression: true });
}

// Ce qui reste à encaisser, comme la page du livreur : commande à encaisser (total moins les manques déduits), ou
// compléments d'une commande modifiée encore dus à la porte ou au comptoir (vague 3, bo-commandes).
async function montantDu(commandeId: string, c: CommandePourTicket & { total_centimes?: number }): Promise<{ centimes: number; complement: boolean } | undefined> {
  if (c.statut_paiement === "a_encaisser_retrait") {
    const manques = await fonctionSql<{ commande_id: string; deduit_centimes: number }[]>("manques_en_cours", {}).catch(() => []);
    const deduit = manques.find((m) => m.commande_id === commandeId)?.deduit_centimes ?? 0;
    return { centimes: (c.total_centimes ?? 0) - deduit, complement: false };
  }
  const d = await fonctionSql<{ complements: { montant_centimes: number; statut: string }[] } | null>("modifications_commande_gestion", { p_commande: commandeId });
  const centimes = (d?.complements ?? []).filter((k) => k.statut === "a_encaisser").reduce((t, k) => t + k.montant_centimes, 0);
  return centimes > 0 ? { centimes, complement: true } : undefined;
}
