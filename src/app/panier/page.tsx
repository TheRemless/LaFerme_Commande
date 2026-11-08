import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PagePanier } from "@/components/panier/PagePanier";
import { chargerCatalogue } from "@/lib/catalogue";

// Même cache que la carte (src/app/carte/page.tsx) : le panier ne lit que le catalogue.
export const revalidate = 60;

// Le panier en pleine page, pour le téléphone (sur ordinateur, il est à droite de la carte).
export default async function Panier() {
  const catalogue = await chargerCatalogue();
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <main id="contenu" className="page-panier">
        <PagePanier catalogue={catalogue} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} />
      </main>
      <PiedDePage />
    </>
  );
}
