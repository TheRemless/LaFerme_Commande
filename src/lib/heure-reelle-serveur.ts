import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import { lireCharge } from "@/lib/heure-reelle";
import type { Charge } from "@/lib/service";

// Détail de la file par poste, pour la tablette et le back-office seulement (routes qui ont vérifié la
// session de l'équipe). Jamais dans une page publique : le nombre d'articles en cuisine dirait les ventes.
// null si la base n'est pas migrée ou ne répond pas.
export async function chargeDuMoment(): Promise<Charge | null> {
  return lireCharge(await fonctionSql<unknown>("charge_cuisine", {}).catch(() => null));
}
