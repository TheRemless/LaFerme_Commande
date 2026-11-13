import "server-only";
import { courrielConfigure } from "@/lib/courriel/envoi";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { etapesMiseEnRoute, type EtatMiseEnRoute, type MiseEnRoute } from "@/lib/mise-en-route-etapes";
import type { Personnel } from "@/lib/personnel/session";
import { destinataireAlertes } from "@/lib/reglages-generaux";

// Mise en route du back-office (vague 3, bo-socle) : l'état réel lu en base (etat_mise_en_route, migration
// 20261213160000), plus ce que seul le serveur sait. Des variables d'envoi et de paiement, on ne lit que leur
// présence, jamais leur valeur.
export async function chargerMiseEnRoute(p: Personnel): Promise<MiseEnRoute> {
  const [etat, impression, alertes] = await Promise.all([
    fonctionSql<EtatMiseEnRoute>("etat_mise_en_route", { p_personnel: p.id }),
    etatImpression().catch(() => null),
    destinataireAlertes().catch(() => undefined),
  ]);
  return etapesMiseEnRoute(etat, {
    imprimantes: impression?.imprimantes ?? [],
    courriel_branche: courrielConfigure(),
    paiement_branche: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    alertes_adresse: Boolean(alertes),
  });
}
