import { ChoixCommande } from "@/components/accueil/ChoixCommande";
import { EnTete } from "@/components/EnTete";
import { MessagesClients } from "@/components/MessagesClients";
import { PiedDePage } from "@/components/PiedDePage";
import { chargerConfigService } from "@/lib/config-service";
import { jsonLd, schemaRestaurant } from "@/lib/schema";
import { DESCRIPTION_SITE, OPEN_GRAPH } from "@/lib/site";
import type { Metadata } from "next";

// Servie depuis le cache de Netlify, refaite au plus toutes les minutes et vidée dès qu'un horaire,
// une zone ou une pause change (rafraichirCaches). L'heure du serveur et les adresses d'un client
// connecté arrivent ensuite par /api/accueil.
export const revalidate = 60;
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...OPEN_GRAPH, title: "La Ferme, livraison et à emporter", description: DESCRIPTION_SITE, url: "/" },
};

// Réseau lent (CM-21) : tant que le JavaScript de la page n'est pas arrivé, un tap sur « Livraison » ou
// « À emporter » est gardé ici, puis appliqué par ChoixCommande dès qu'elle répond.
const TAP_AVANT_CHARGEMENT =
  'document.addEventListener("click",function(e){if(window.__laFermePret)return;var b=e.target&&e.target.closest&&e.target.closest("[data-mode]");if(b)window.__laFermeMode=b.getAttribute("data-mode")},true);';

export default async function Accueil() {
  const config = await chargerConfigService();
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const propositions = config.zones.some((z) => z.proposition);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schemaRestaurant()) }} />
      <EnTete />
      <MessagesClients messages={config.messages} page="accueil" rendu={Date.now()} />
      {preversion && propositions && (
        <p className="bandeau-preversion" role="note">
          Préversion : zones, frais, horaires et prix proposés, en attente de validation.
        </p>
      )}
      <script dangerouslySetInnerHTML={{ __html: TAP_AVANT_CHARGEMENT }} />
      <main id="contenu" className="page-accueil">
        <ChoixCommande config={config} maintenantServeur={Date.now()} preversion={preversion} />
      </main>
      <PiedDePage />
    </>
  );
}
