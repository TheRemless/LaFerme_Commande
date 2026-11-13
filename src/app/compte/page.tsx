import type { Metadata } from "next";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { Connexion } from "@/components/compte/Connexion";
import { EspaceCompte, type Appareil, type DonneesEspace } from "@/components/compte/EspaceCompte";
import { compteCourant, jetonSession } from "@/lib/comptes/session";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Votre compte, La Ferme", robots: PRIVE };

export default async function Compte() {
  const compte = await compteCourant();
  const donnees = compte ? await fonctionSql<DonneesEspace | null>("espace_compte", { p_compte: compte.id }) : null;
  // Total et suite de l'historique (migration 20261202120000) ; sans elle, les 30 dernières comme avant.
  const historique = compte
    ? await fonctionSql<{ suite: boolean; total: number }>("commandes_compte", { p_compte: compte.id, p_avant: null, p_limite: 30 }).catch(() => null)
    : null;
  // Appareils connectés (migration 20261202140000) ; sans elle, le nombre seul comme avant.
  const jeton = compte ? await jetonSession() : null;
  const appareils =
    compte && jeton
      ? await fonctionSql<Appareil[]>("appareils_compte", { p_compte: compte.id, p_session_hache: empreinte("session", jeton) }).catch(() => null)
      : null;
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-compte">
        {donnees ? <EspaceCompte donnees={donnees} historique={historique ? { suite: historique.suite, total: historique.total } : null} appareils={appareils} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} /> : <Connexion />}
      </main>
      <PiedDePage />
    </>
  );
}
