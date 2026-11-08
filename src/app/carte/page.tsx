import type { Metadata } from "next";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { CarteCommande } from "@/components/carte/CarteCommande";
import { chargerCarte } from "@/lib/carte";
import { chargerCatalogue } from "@/lib/catalogue";
import { DESCRIPTION_CARTE, OPEN_GRAPH } from "@/lib/site";

// Servie depuis le cache de Netlify, refaite au plus toutes les minutes. Le back-office et la
// tablette la vident aussitôt qu'un prix ou une rupture change (rafraichirCaches).
export const revalidate = 60;
export const metadata: Metadata = {
  title: "La carte, La Ferme",
  description: DESCRIPTION_CARTE,
  alternates: { canonical: "/carte" },
  openGraph: { ...OPEN_GRAPH, title: "La carte, La Ferme", description: DESCRIPTION_CARTE, url: "/carte" },
};

export default async function PageCarte() {
  const [{ categories, source }, catalogue] = await Promise.all([chargerCarte(), chargerCatalogue()]);
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const aValider = categories.some((c) => c.plats.some((p) => p.prix_a_valider));
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      {preversion && aValider && (
        <p className="bandeau-preversion" role="note">
          Préversion : prix proposés, en attente de validation.
        </p>
      )}
      {/* Sur les previews, data-source dit d'où vient la carte (Supabase ou base embarquée). */}
      <main id="contenu" className="page-carte" data-source={preversion ? source : undefined}>
        <CarteCommande categories={categories} catalogue={catalogue} preversion={preversion} />
      </main>
      <PiedDePage />
    </>
  );
}
