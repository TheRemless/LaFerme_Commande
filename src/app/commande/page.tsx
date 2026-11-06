import { Suspense } from "react";
import { EnTete } from "@/components/EnTete";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PageCommande } from "@/components/commande/PageCommande";
import { chargerCatalogue } from "@/lib/catalogue";

export const dynamic = "force-dynamic";

export default async function Commande() {
  const catalogue = await chargerCatalogue();
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <main className="page-commande">
        <Suspense>
          <PageCommande catalogue={catalogue} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} />
        </Suspense>
      </main>
    </>
  );
}
