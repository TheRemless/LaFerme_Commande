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
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-compte">
        {donnees ? <EspaceCompte donnees={donnees} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} /> : <Connexion />}
      </main>
      <PiedDePage />
    </>
  );
}
