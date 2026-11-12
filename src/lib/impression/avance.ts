import { heureDe, jourGeneveDe } from "@/lib/heures";
import { jourTexte } from "@/lib/service";

// Commandes à l'avance (audit « samedi soir », SS-11, audit du gérant, G08) : les premiers tickets d'une
// commande acceptée sortent impression_avance_minutes avant l'heure promise. Partagé par le serveur et la tablette.

// Valeur proposée : le délai le plus long annoncé aux clients (zone 2, 50 minutes préparation comprise) plus
// dix minutes de marge. Sert aussi tant que le réglage manque en base.
export const IMPRESSION_AVANCE_DEFAUT = 60;

export function heureImpression(heureConfirmee: string, avanceMinutes: number): Date {
  return new Date(new Date(heureConfirmee).getTime() - avanceMinutes * 60_000);
}

// « à 18h30 » le jour même, « le samedi 14 novembre à 18h30 » un autre jour.
export function momentTexte(instant: Date | string, maintenant: Date | string): string {
  const jour = jourGeneveDe(instant);
  return jour === jourGeneveDe(maintenant) ? `à ${heureDe(instant)}` : `le ${jourTexte(jour)} à ${heureDe(instant)}`;
}
