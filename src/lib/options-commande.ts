import "server-only";
import { fonctionSql } from "@/lib/db/serveur";

// Couverts et serviettes (C8) et prénom par ligne (C5) : construits mais éteints tant que Jérémy n'a pas
// décidé (réglages couverts_actifs et prenom_par_ligne_actif). Fonction absente ou base muette : éteints.
export type OptionsCommande = { couverts_actifs: boolean; prenom_par_ligne_actif: boolean };

export const OPTIONS_ETEINTES: OptionsCommande = { couverts_actifs: false, prenom_par_ligne_actif: false };

export async function chargerOptionsCommande(): Promise<OptionsCommande> {
  try {
    return (await fonctionSql<OptionsCommande | null>("options_commande", {})) ?? OPTIONS_ETEINTES;
  } catch {
    return OPTIONS_ETEINTES;
  }
}
