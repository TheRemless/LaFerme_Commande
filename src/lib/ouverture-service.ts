import { jourIso } from "@/lib/service";

// Horaires du restaurant tels que les renvoie /api/gestion/service (écran Livreurs du back-office).
export type Horaires = {
  horaires: { jour: number; service: "midi" | "soir" }[];
  fermetures: { debut: string; fin: string; motif: string; service?: "midi" | "soir" | null }[];
  ouvertures: { jour: string; service: "midi" | "soir" }[];
};

// Le restaurant sert-il ce service ce jour-là ? Même règle que le site (servicesDu, src/lib/service.ts) :
// horaires de la semaine, ouverture exceptionnelle, fermeture du jour ou du service. null : horaires pas lus.
export type Ouverture = { ouvert: true } | { ouvert: false; motif: string | null };
export function ouvertureDe(h: Horaires | null, jour: string, service: "midi" | "soir"): Ouverture | null {
  if (!h) return null;
  const fermeture = h.fermetures.find((f) => f.debut <= jour && jour <= f.fin && (!f.service || f.service === service));
  if (fermeture) return { ouvert: false, motif: fermeture.motif };
  const ouvert = h.ouvertures.some((o) => o.jour === jour && o.service === service) || h.horaires.some((x) => x.jour === jourIso(jour) && x.service === service);
  return ouvert ? { ouvert: true } : { ouvert: false, motif: null };
}
