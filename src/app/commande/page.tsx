import { Suspense } from "react";
import { EnTete } from "@/components/EnTete";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PageCommande } from "@/components/commande/PageCommande";
import { chargerCatalogue } from "@/lib/catalogue";
import { compteCourant } from "@/lib/comptes/session";

export const dynamic = "force-dynamic";

export default async function Commande() {
  const [catalogue, compte] = await Promise.all([chargerCatalogue(), compteCourant()]);
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <main className="page-commande">
        <Suspense>
          <PageCommande catalogue={catalogue} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"}
            compte={compte && { email: compte.email, prenom: compte.prenom, nom: compte.nom, telephone: compte.telephone }}
          />
        </Suspense>
      </main>
    </>
  );
}
