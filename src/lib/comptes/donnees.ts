import "server-only";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";

// Droits du client sur ses données (nLPD) : export et suppression du compte. L'e-mail vient toujours du compte
// de la session, jamais de la requête.

// Fonction absente : la base n'a pas encore reçu la migration qui l'apporte (20261127120000, bo-commandes).
function fonctionAbsente(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /does not exist|Could not find the function|PGRST202/.test(m);
}

// Export : tout ce que le compte garde, plus ce que le restaurant note sur le client (notes internes, marque).
export async function exporterCompte(compte: { id: string; email: string }, ipCourte: string): Promise<unknown> {
  const donnees = await fonctionSql<Record<string, unknown> | null>("export_compte", { p_compte: compte.id, p_ip_court: ipCourte });
  if (!donnees) return donnees;
  try {
    return { ...donnees, restaurant: await fonctionSql<unknown>("donnees_gestion_client", { p_email: compte.email }) };
  } catch (e) {
    if (!fonctionAbsente(e)) throw e;
    return donnees;
  }
}

// Suppression : les notes du restaurant d'abord ; si elles ne s'effacent pas, le compte reste (jamais un
// « compte supprimé » avec des notes derrière). La marque « à surveiller » ou « bloqué » part avec (décision
// de Jérémy, 13.11.2026).
export async function supprimerCompte(compte: { id: string; email: string }): Promise<boolean> {
  try {
    await fonctionSql<number>("effacer_notes_client", { p_email: compte.email });
  } catch (e) {
    if (!fonctionAbsente(e)) throw e;
  }
  return fonctionSql<boolean>("supprimer_compte", { p_compte: compte.id, p_cle_email: empreinte("email", compte.email) });
}
