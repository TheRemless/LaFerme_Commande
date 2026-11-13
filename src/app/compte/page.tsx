import type { Metadata } from "next";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { Connexion } from "@/components/compte/Connexion";
import { EspaceCompte, type DonneesEspace } from "@/components/compte/EspaceCompte";
import { compteCourant } from "@/lib/comptes/session";
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
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-compte">
        {donnees ? <EspaceCompte donnees={donnees} historique={historique ? { suite: historique.suite, total: historique.total } : null} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} /> : <Connexion />}
      </main>
      <PiedDePage />
    </>
  );
}
