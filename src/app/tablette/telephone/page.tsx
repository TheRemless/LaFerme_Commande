import type { Metadata } from "next";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { CommandeTelephone } from "@/components/tablette/CommandeTelephone";
import { chargerCarte } from "@/lib/carte";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";
import "@/components/tablette/tablette.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commande au téléphone, La Ferme", robots: PRIVE, manifest: "/tablette.webmanifest" };

// Commande prise au téléphone (vague 3, bo-commandes) : toute l'équipe de la tablette, jamais un livreur.
export default async function PageCommandeTelephone() {
  const personnel = await personnelCourant();
  if (!personnel) {
    return (
      <main id="contenu" className="page-tablette">
        <ConnexionPersonnel />
      </main>
    );
  }
  if (personnel.role === "livreur") {
    return (
      <main id="contenu" className="page-tablette">
        <div className="connexion connexion-personnel">
          <h1>Tablette du restaurant</h1>
          <p>Votre compte est celui d&apos;un livreur. Vos livraisons sont sur une autre page.</p>
          <a className="bouton-principal" href="/livreur">
            Mes livraisons
          </a>
        </div>
      </main>
    );
  }
  const [{ categories }, catalogue, config] = await Promise.all([chargerCarte(), chargerCatalogue(), chargerConfigService()]);
  return (
    <main id="contenu" className="page-tablette">
      <CommandeTelephone categories={categories} catalogue={catalogue} config={config} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} />
    </main>
  );
}
