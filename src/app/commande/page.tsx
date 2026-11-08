import type { Metadata } from "next";
import { Suspense } from "react";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PageCommande } from "@/components/commande/PageCommande";
import { chargerCatalogue } from "@/lib/catalogue";
import { compteCourant } from "@/lib/comptes/session";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finaliser la commande, La Ferme", robots: PRIVE };

export default async function Commande() {
  const [catalogue, compte] = await Promise.all([chargerCatalogue(), compteCourant()]);
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <main id="contenu" className="page-commande">
        <Suspense>
          <PageCommande catalogue={catalogue} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"}
            compte={compte && { email: compte.email, prenom: compte.prenom, nom: compte.nom, telephone: compte.telephone }}
          />
        </Suspense>
      </main>
      <PiedDePage />
    </>
  );
}
