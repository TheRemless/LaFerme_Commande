import { detailsLigne } from "@/lib/courriel/modeles";
import type { Commande } from "@/lib/db/serveur";
import { nomClient } from "@/lib/nom-plat";
import type { Catalogue } from "@/lib/panier";
import { prixChf } from "@/lib/prix";
import type { RemboursementSuivi } from "@/lib/suivi";

// Reçu avec TVA d'une commande payée, depuis le suivi et le compte. Mention de livraison avec le nom et la localité
// seule : le lien de suivi se transfère, le reçu aussi. L'adresse complète n'est montrée qu'au titulaire du compte
// connecté (décision du chef du 19.11.2026). Jamais de téléphone.

// Vendeur (raison sociale, adresse, numéro de TVA) : un seul endroit, partagé avec le justificatif papier.
export { VENDEUR } from "@/lib/vendeur";

// Une vente encaissée : payée en ligne ou au comptoir. Une commande refusée ou annulée n'est pas une vente.
export function recuDisponible(c: Pick<Commande, "statut" | "statut_paiement">): boolean {
  if (["paiement_en_attente", "annulee", "refusee"].includes(c.statut)) return false;
  return c.statut_paiement === "paye" || c.statut_paiement === "encaisse" || c.statut_paiement === "rembourse";
}

// Mention du justificatif qui fonde la TVA à 2,6 % (AFC, Info TVA 08 ch. 1.3.2, 1.3.3 et 12 ; plan de conformité
// compta R6), mêmes mots que le ticket du sac (src/lib/impression/ticket.ts). complet : rue et numéro en plus de la
// localité (e-mail de commande, compte du client).
type PourMention = Pick<Commande, "mode" | "client_prenom" | "client_nom" | "adresse"> & { destinataire?: { nom?: string } | null };
export function mentionLivraison(c: PourMention, complet: boolean): string[] {
  if (c.mode !== "livraison") return ["À l'emporter"];
  const nom = c.destinataire?.nom?.trim() || `${c.client_prenom} ${c.client_nom}`.trim();
  const a = c.adresse;
  const lieu = !a ? [] : complet ? [`${a.rue}${a.numero ? ` ${a.numero}` : ""}`, `${a.npa} ${a.localite}`] : [a.localite];
  return ["Livraison sans préparation ni service à", nom, ...lieu];
}

// Taux par ligne (R7) : un code avec sa légende, comme le ticket. Un seul taux tant que la carte n'en porte pas par
// plat (colonne de bo-carte à venir).
export const CODE_TVA = "A";
export function legendeTva(c: Pick<Commande, "taux_tva_pourcent">): string {
  return `${CODE_TVA} = TVA ${String(c.taux_tva_pourcent).replace(".", ",")} % comprise`;
}

function date(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export type Recu = {
  numero: number;
  date: string;
  mention: string[];
  legende: string;
  lignes: { titre: string; details: string[]; montant: string }[];
  sommes: [string, string][];
  paiement: string;
  remboursements: string[];
};

export function donneesRecu(
  c: Commande & { paye_le?: string | null; destinataire?: { nom?: string } | null },
  cat: Catalogue | null,
  remboursements: RemboursementSuivi[],
  { complet = false }: { complet?: boolean } = {},
): Recu {
  return {
    numero: c.numero,
    date: date(c.paye_le ?? c.cree_le),
    mention: mentionLivraison(c, complet),
    legende: legendeTva(c),
    lignes: c.lignes.map((l) => ({
      titre: `${l.qte} × ${nomClient(l.nom, l.station === "pizza")}`,
      details: detailsLigne(cat, l),
      montant: `${(l.total_centimes / 100).toFixed(2)} ${CODE_TVA}`,
    })),
    sommes: [
      ["Plats", prixChf(c.sous_total_centimes)],
      ...(c.mode === "livraison" ? ([["Livraison", `${prixChf(c.frais_centimes)} ${CODE_TVA}`]] as [string, string][]) : []),
      // Cagnotte : réduction de prix, la TVA est calculée sur le total net (vague 3).
      ...(c.cagnotte_centimes ? ([["Cagnotte utilisée", `− ${prixChf(c.cagnotte_centimes)}`]] as [string, string][]) : []),
      ["Total", prixChf(c.total_centimes)],
      [`dont TVA ${String(c.taux_tva_pourcent).replace(".", ",")} %`, prixChf(c.tva_centimes)],
    ],
    paiement: c.moyen_paiement === "comptoir" ? "Payé au comptoir" : "Payé en ligne",
    remboursements: remboursements
      .filter((r) => r.statut === "fait" && r.moyen !== "deduction")
      .map((r) => `${prixChf(r.montant_centimes)} ${r.moyen === "especes" ? "rendus au comptoir" : r.moyen === "terminal" ? "rendus sur la carte" : "remboursés"} le ${date(r.fait_le ?? r.cree_le)}.`),
  };
}
