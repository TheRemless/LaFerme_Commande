import type { Metadata } from "next";
import { BackOffice } from "@/components/gestion/BackOffice";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { fonctionSql } from "@/lib/db/serveur";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";
import "./back-office.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Back-office, La Ferme", template: "%s, back-office La Ferme" },
  robots: PRIVE,
};

// Toutes les rubriques /gestion/** : réservées au rôle gérant, même connexion que la tablette.
// Le contrôle est fait ici, une fois, côté serveur. Les pages ne portent aucune donnée : elles
// chargent par les API /api/gestion/**, qui revérifient le gérant à chaque requête.
export default async function LayoutGestion({ children }: { children: React.ReactNode }) {
  const personnel = await personnelCourant();
  if (personnel?.role === "gerant") return <BackOffice nom={personnel.nom}>{children}</BackOffice>;
  // Responsable de service (D1) : seulement quand le rôle est activé, et seulement ses rubriques (navigation.ts).
  if (personnel?.role === "responsable" && (await fonctionSql<boolean>("role_responsable_actif", {}).catch(() => false)))
    return (
      <BackOffice nom={personnel.nom} role="responsable">
        {children}
      </BackOffice>
    );
  return (
    <main id="contenu" className="page-tablette">
      {!personnel ? (
        <ConnexionPersonnel titre="Back-office du restaurant" />
      ) : (
        <div className="connexion connexion-personnel">
          <h1>Back-office du restaurant</h1>
          <p>Réservé au gérant. Votre compte donne accès {personnel.role === "livreur" ? "à vos livraisons" : "à la tablette"}.</p>
          <a className="bouton-second" href={personnel.role === "livreur" ? "/livreur" : "/tablette"}>
            {personnel.role === "livreur" ? "Mes livraisons" : "Ouvrir la tablette"}
          </a>
        </div>
      )}
    </main>
  );
}
