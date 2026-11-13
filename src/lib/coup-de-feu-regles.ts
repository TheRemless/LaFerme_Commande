// Contrôle des réglages du coup de feu, sans dépendance au serveur (testé seul, réutilisable à l'écran).
// Mêmes bornes que lancer_coup_de_feu en base.

export type ReglagesCoupDeFeu = {
  retard_minutes: number;
  duree_minutes: number;
  livraison_fermee: boolean;
  capacite_livraison: number | null;
  capacite_retrait: number | null;
};

const entier = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function validerCoupDeFeu(corps: unknown): { ok: true; valeur: ReglagesCoupDeFeu } | { ok: false; erreur: string } {
  if (!corps || typeof corps !== "object") return { ok: false, erreur: "Réglages illisibles." };
  const c = corps as Record<string, unknown>;
  const retard = c.retard_minutes ?? 0;
  if (!entier(retard, 0, 90)) return { ok: false, erreur: "Retard : un nombre de minutes de 0 à 90." };
  if (!entier(c.duree_minutes, 15, 360)) return { ok: false, erreur: "Durée : de 15 minutes à 6 heures." };
  const fermee = c.livraison_fermee ?? false;
  if (typeof fermee !== "boolean") return { ok: false, erreur: "Livraison fermée : oui ou non." };
  const capacite = (v: unknown) => (v === null || v === undefined ? null : entier(v, 1, 50) ? (v as number) : undefined);
  const capL = capacite(c.capacite_livraison);
  const capR = capacite(c.capacite_retrait);
  if (capL === undefined || capR === undefined) return { ok: false, erreur: "Commandes par créneau : un nombre de 1 à 50." };
  if (retard === 0 && !fermee && capL === null && capR === null) return { ok: false, erreur: "Choisissez au moins un changement." };
  return {
    ok: true,
    valeur: { retard_minutes: retard as number, duree_minutes: c.duree_minutes as number, livraison_fermee: fermee, capacite_livraison: capL, capacite_retrait: capR },
  };
}
