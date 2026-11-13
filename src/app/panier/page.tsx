import type { Metadata } from "next";
import { EnTete } from "@/components/EnTete";
import { MessagesClients } from "@/components/MessagesClients";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PagePanier } from "@/components/panier/PagePanier";
import { chargerCarte } from "@/lib/carte";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { chargerPopulaires } from "@/lib/populaires";
import { chargerOptionsCommande } from "@/lib/options-commande";
import { PRIVE } from "@/lib/site";

// Même cache que la carte (src/app/carte/page.tsx) : catalogue, plus la carte pour rouvrir la fiche d'une ligne.
export const revalidate = 60;
export const metadata: Metadata = { title: "Votre panier, La Ferme", robots: PRIVE };

// Le panier en pleine page, pour le téléphone (sur ordinateur, il est à droite de la carte).
export default async function Panier() {
  const [{ categories }, catalogue, populaires, options, config] = await Promise.all([
    chargerCarte(),
    chargerCatalogue(),
    chargerPopulaires(),
    chargerOptionsCommande(),
    chargerConfigService(),
  ]);
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <MessagesClients messages={config.messages} page="panier" rendu={Date.now()} />
      <main id="contenu" className="page-panier">
        <PagePanier
          catalogue={catalogue}
          plats={categories.flatMap((c) => c.plats)}
          populaires={populaires}
          prenomActif={options.prenom_par_ligne_actif}
          preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"}
        />
      </main>
      <PiedDePage />
    </>
  );
}
