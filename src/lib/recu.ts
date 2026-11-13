import { detailsLigne } from "@/lib/courriel/modeles";
import type { Commande } from "@/lib/db/serveur";
import { nomClient } from "@/lib/nom-plat";
import type { Catalogue } from "@/lib/panier";
import { prixChf } from "@/lib/prix";
import type { RemboursementSuivi } from "@/lib/suivi";

// Reçu avec TVA d'une commande payée, depuis le suivi et le compte. Pas de nom de famille, de téléphone ni
// d'adresse de livraison : le lien de suivi se transfère, le reçu aussi.

// Registre de faits La Ferme : extrait du registre du commerce de Genève (rc.ge.ch, 13.11.2026) et registre
// IDE fédéral (uid.admin.ch, lu le 13.11.2026, TVA active depuis le 1.1.2016).
export const VENDEUR = {
  raison: "Restaurant La Ferme Sàrl",
  adresse: "Route de Chancy 132, 1213 Onex",
  tva: "CHE-103.250.692 TVA",
} as const;

// Une vente encaissée : payée en ligne ou au comptoir. Une commande refusée ou annulée n'est pas une vente.
export function recuDisponible(c: Pick<Commande, "statut" | "statut_paiement">): boolean {
  if (["paiement_en_attente", "annulee", "refusee"].includes(c.statut)) return false;
  return c.statut_paiement === "paye" || c.statut_paiement === "encaisse" || c.statut_paiement === "rembourse";
}

function date(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export type Recu = {
  numero: number;
  date: string;
  mode: string;
  lignes: { titre: string; details: string[]; montant: string }[];
  sommes: [string, string][];
  paiement: string;
  remboursements: string[];
};

export function donneesRecu(c: Commande & { paye_le?: string | null }, cat: Catalogue | null, remboursements: RemboursementSuivi[]): Recu {
  return {
    numero: c.numero,
    date: date(c.paye_le ?? c.cree_le),
    mode: c.mode === "livraison" ? "Livraison" : "À emporter",
    lignes: c.lignes.map((l) => ({
      titre: `${l.qte} × ${nomClient(l.nom, l.station === "pizza")}`,
      details: detailsLigne(cat, l),
      montant: (l.total_centimes / 100).toFixed(2),
    })),
    sommes: [
      ["Plats", prixChf(c.sous_total_centimes)],
      ...(c.mode === "livraison" ? ([["Livraison", prixChf(c.frais_centimes)]] as [string, string][]) : []),
      ["Total", prixChf(c.total_centimes)],
      [`dont TVA ${String(c.taux_tva_pourcent).replace(".", ",")} %`, prixChf(c.tva_centimes)],
    ],
    paiement: c.moyen_paiement === "comptoir" ? "Payé au comptoir" : "Payé en ligne",
    remboursements: remboursements
      .filter((r) => r.statut === "fait" && r.moyen !== "deduction")
      .map((r) => `${prixChf(r.montant_centimes)} ${r.moyen === "especes" ? "rendus au comptoir" : "remboursés"} le ${date(r.fait_le ?? r.cree_le)}.`),
  };
}
