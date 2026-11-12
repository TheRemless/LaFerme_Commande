import { heureDe, jourGeneveDe } from "@/lib/heures";
import { jourTexte } from "@/lib/service";

// Commandes à l'avance (audit « samedi soir », SS-11, audit du gérant, G08) : les premiers tickets d'une
// commande acceptée sortent, avant l'heure promise, le délai de son mode. Partagé par le serveur et la tablette.

export type DelaisImpression = { livraison: number; retrait: number };

// Valeurs validées par Jérémy le 12.11.2026 : livraison 60 minutes (zone 2, 50 minutes préparation comprise,
// plus 10 de marge), retrait 30 minutes (préparation 20, plus 10). Servent aussi tant que le réglage manque.
export const IMPRESSION_AVANCE_DEFAUT: DelaisImpression = { livraison: 60, retrait: 30 };

export function heureImpression(heureConfirmee: string, avanceMinutes: number): Date {
  return new Date(new Date(heureConfirmee).getTime() - avanceMinutes * 60_000);
}

// « à 18h30 » le jour même, « le samedi 14 novembre à 18h30 » un autre jour.
export function momentTexte(instant: Date | string, maintenant: Date | string): string {
  const jour = jourGeneveDe(instant);
  return jour === jourGeneveDe(maintenant) ? `à ${heureDe(instant)}` : `le ${jourTexte(jour)} à ${heureDe(instant)}`;
}
