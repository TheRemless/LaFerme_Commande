// Plafond des commandes à payer au comptoir (décision de Jérémy du 12.11.2026, suite de S5 de l'audit de sécurité).
// Le montant est un réglage en base (reglages.plafond_comptoir_centimes) : la base le revérifie à l'enregistrement.

export const CLE_PLAFOND_COMPTOIR = "plafond_comptoir_centimes";

export function lirePlafondComptoir(reglages: { cle: string; valeur: unknown }[]): number | null {
  const v = Number(reglages.find((r) => r.cle === CLE_PLAFOND_COMPTOIR)?.valeur);
  return Number.isInteger(v) && v > 0 ? v : null;
}

// Réglage absent ou illisible : pas de comptoir (rien n'est payé avant le retrait).
export function comptoirPermis(totalCentimes: number | null, plafondCentimes: number | null): boolean {
  return plafondCentimes !== null && totalCentimes !== null && totalCentimes <= plafondCentimes;
}
