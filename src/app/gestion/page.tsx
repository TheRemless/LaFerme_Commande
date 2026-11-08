import type { Metadata } from "next";
import { BackOffice } from "@/components/gestion/BackOffice";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Back-office, La Ferme", robots: PRIVE };

// Réservé au rôle gérant. Même connexion que la tablette.
export default async function PageGestion() {
  const personnel = await personnelCourant();
  return (
    <main id="contenu" className="page-tablette">
      {!personnel ? (
        <ConnexionPersonnel titre="Back-office du restaurant" />
      ) : personnel.role !== "gerant" ? (
        <div className="connexion connexion-personnel">
          <h1>Back-office du restaurant</h1>
          <p>Réservé au gérant. Votre compte donne accès à la tablette.</p>
          <a className="bouton-second" href="/tablette">
            Ouvrir la tablette
          </a>
        </div>
      ) : (
        <BackOffice nom={personnel.nom} />
      )}
    </main>
  );
}
