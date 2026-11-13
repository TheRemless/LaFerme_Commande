// Zone de livraison fermée jusqu'à une heure (réglage du back-office, bo-operations) : le client apprend
// quand la livraison reprend, au lieu de lire « hors zone ». Même texte à l'accueil, au panier et au paiement.
import { heureTexte, instantGeneve, jourTexte } from "@/lib/service";

export function messageZoneFermee(jusqua: string, maintenant: Date = new Date()): string {
  const fin = instantGeneve(new Date(jusqua));
  const quand = fin.date === instantGeneve(maintenant).date ? `à ${heureTexte(fin.minutes)}` : `le ${jourTexte(fin.date)} à ${heureTexte(fin.minutes)}`;
  return `La livraison reprend ${quand} dans votre quartier.`;
}

export const SUITE_ZONE_FERMEE = "Vous pouvez commander à emporter.";
