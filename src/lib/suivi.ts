import "server-only";
import type { Commande } from "@/lib/db/serveur";
import { fonctionSql } from "@/lib/db/serveur";
import { prixChf } from "@/lib/prix";
import { TELEPHONE_RESTAURANT } from "@/lib/livraisons-textes";
import { DELAI_REMBOURSEMENT } from "@/lib/courriel/modeles";

// Ce que la page de suivi dit des remboursements et du retard. Textes passés par redaction-fr (voix de La Ferme).

export type RemboursementSuivi = {
  montant_centimes: number;
  moyen: "stripe" | "especes" | "deduction";
  statut: "en_cours" | "fait" | "echec";
  cree_le: string;
  fait_le: string | null;
};

// Sans la migration 20261202090000 (ou sur une erreur de lecture), la page reste comme avant : aucune ligne.
export async function remboursementsSuivi(commandeId: string): Promise<RemboursementSuivi[]> {
  try {
    return (await fonctionSql<RemboursementSuivi[] | null>("suivi_remboursements", { p_commande: commandeId })) ?? [];
  } catch (e) {
    console.error(`Remboursements du suivi non lus : ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

function jour(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "long" }).format(new Date(iso));
}

export type PhraseRemboursement = { texte: string; etat: "fait" | "en_cours" | "echec" };

export function phraseRemboursement(r: RemboursementSuivi): PhraseRemboursement {
  const montant = prixChf(r.montant_centimes);
  if (r.moyen === "deduction") {
    return r.statut === "fait"
      ? { etat: "fait", texte: `${montant} déduits du montant à payer au comptoir.` }
      : { etat: r.statut, texte: `${montant} à déduire du montant à payer au comptoir.` };
  }
  if (r.moyen === "especes") {
    return r.statut === "fait"
      ? { etat: "fait", texte: `${montant} rendus au comptoir.` }
      : { etat: r.statut, texte: `${montant} à vous rendre au comptoir.` };
  }
  if (r.statut === "fait") {
    return { etat: "fait", texte: `${montant} remboursés le ${jour(r.fait_le ?? r.cree_le)}. La somme revient sur le moyen de paiement utilisé. ${DELAI_REMBOURSEMENT}` };
  }
  if (r.statut === "echec") {
    return { etat: "echec", texte: `Le remboursement de ${montant} n'a pas abouti. Le restaurant est prévenu. Appelez-nous au ${TELEPHONE_RESTAURANT}.` };
  }
  return { etat: "en_cours", texte: `${montant} en cours de remboursement. La banque ne l'a pas encore confirmé.` };
}

// Libellé du total. « Remboursée » seulement quand tout ce qui a été demandé chez Stripe est confirmé.
export function libellePaiement(c: Pick<Commande, "statut_paiement">, remboursements: RemboursementSuivi[]): string {
  const stripe = remboursements.filter((r) => r.moyen === "stripe");
  switch (c.statut_paiement) {
    case "paye":
      return "Payée en ligne";
    case "a_encaisser_retrait":
      return "À payer au comptoir";
    case "rembourse":
      return stripe.every((r) => r.statut === "fait") ? "Remboursée" : "Payée en ligne";
    case "encaisse":
      return "Payée au comptoir";
    default:
      return "Paiement en attente";
  }
}

// Reste à payer au comptoir, déductions faites (manque sur une commande pas encore payée).
export function resteComptoir(c: Pick<Commande, "statut_paiement" | "total_centimes">, remboursements: RemboursementSuivi[]): number | null {
  if (c.statut_paiement !== "a_encaisser_retrait") return null;
  const deduit = remboursements.filter((r) => r.moyen === "deduction" && r.statut === "fait").reduce((s, r) => s + r.montant_centimes, 0);
  return deduit > 0 ? Math.max(0, c.total_centimes - deduit) : null;
}

// Retard : l'heure confirmée est passée de 10 minutes et la commande n'est pas arrivée au bout.
// À emporter, une commande prête n'est pas en retard (elle attend le client).
export const MARGE_RETARD_MINUTES = 10;
export function enRetard(c: Pick<Commande, "statut" | "mode" | "heure_confirmee">, maintenant = new Date()): boolean {
  if (!c.heure_confirmee) return false;
  const encore = c.mode === "livraison" ? ["acceptee", "en_preparation", "prete", "partie"] : ["acceptee", "en_preparation"];
  if (!encore.includes(c.statut)) return false;
  return maintenant.getTime() > new Date(c.heure_confirmee).getTime() + MARGE_RETARD_MINUTES * 60_000;
}

export const PHRASE_RETARD = `Nous avons du retard sur l'heure prévue. Une question ? Appelez-nous au ${TELEPHONE_RESTAURANT}.`;
