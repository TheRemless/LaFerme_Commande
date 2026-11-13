// Panne du service fédéral des adresses (geo.admin.ch) : le serveur ne peut pas revérifier l'adresse de
// livraison, au panier comme au paiement. Le client garde deux issues : commander à emporter, ou appeler.
// Fichier sans code serveur : lu par src/lib/zone-serveur.ts et par le panier et le paiement.
import { ecrireChoix, type Choix } from "@/lib/choix";

export const MESSAGE_REGISTRE_EN_PANNE =
  "Le service fédéral des adresses ne répond pas. Nous ne pouvons pas vérifier votre adresse de livraison pour le moment. Commandez à emporter, ou appelez‑nous au 022 792 16 89.";

export function estPanneRegistre(erreur: string | null | undefined): boolean {
  return erreur === MESSAGE_REGISTRE_EN_PANNE;
}

// « Commander à emporter » : le choix passe à emporter, dès que possible ; l'accueil (lien vers « / ») montre
// l'heure du retrait à confirmer. Le panier reste tel quel.
export function passerAEmporter(choix: Choix | null): void {
  ecrireChoix({ mode: "retrait", quand: { type: "asap" }, ...(choix?.heureSimulee ? { heureSimulee: choix.heureSimulee } : {}) });
}
