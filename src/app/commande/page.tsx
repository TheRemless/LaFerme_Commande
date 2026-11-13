import type { Metadata } from "next";
import { Suspense } from "react";
import { EnTete } from "@/components/EnTete";
import { MessagesClients } from "@/components/MessagesClients";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { PageCommande } from "@/components/commande/PageCommande";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { compteCourant } from "@/lib/comptes/session";
import { chargerOptionsCommande } from "@/lib/options-commande";
import { codesActifs } from "@/lib/code-promo";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finaliser la commande, La Ferme", robots: PRIVE };

export default async function Commande() {
  const [catalogue, compte, options, codes, config] = await Promise.all([chargerCatalogue(), compteCourant(), chargerOptionsCommande(), codesActifs(), chargerConfigService()]);
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      <MessagesClients messages={config.messages} page="paiement" rendu={Date.now()} />
      <main id="contenu" className="page-commande">
        <Suspense>
          <PageCommande catalogue={catalogue} preversion={process.env.CONTEXTE_DEPLOIEMENT !== "production"} couvertsActifs={options.couverts_actifs} codesActifs={codes}
            compte={compte && { email: compte.email, prenom: compte.prenom, nom: compte.nom, telephone: compte.telephone }}
          />
        </Suspense>
      </main>
      <PiedDePage />
    </>
  );
}
