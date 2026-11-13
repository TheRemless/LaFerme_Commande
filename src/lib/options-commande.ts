import "server-only";
import { fonctionSql } from "@/lib/db/serveur";

// Couverts et serviettes (C8), prénom par ligne (C5) et adresse acceptée sur son NPA quand le registre fédéral
// est en panne (C15) : réglages couverts_actifs, prenom_par_ligne_actif et npa_seul_en_panne_actif. Fonction
// absente ou base muette : éteints.
export type OptionsCommande = { couverts_actifs: boolean; prenom_par_ligne_actif: boolean; npa_seul_en_panne_actif?: boolean };

export const OPTIONS_ETEINTES: OptionsCommande = { couverts_actifs: false, prenom_par_ligne_actif: false, npa_seul_en_panne_actif: false };

export async function chargerOptionsCommande(): Promise<OptionsCommande> {
  try {
    return (await fonctionSql<OptionsCommande | null>("options_commande", {})) ?? OPTIONS_ETEINTES;
  } catch {
    return OPTIONS_ETEINTES;
  }
}
