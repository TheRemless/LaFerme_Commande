import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PageLegaleVue } from "@/components/legal/PageLegaleVue";
import { PiedDePage } from "@/components/PiedDePage";
import { pageLegalePubliable, pagesLegalesValidees } from "@/lib/legal/acces";
import { CONFIDENTIALITE } from "@/lib/legal/confidentialite";

// Lue à chaque requête : poser PAGES_LEGALES_VALIDEES sur Netlify suffit, sans rebâtir le site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confidentialité, La Ferme" };

export default function Page() {
  if (!pageLegalePubliable(CONFIDENTIALITE)) notFound();
  return (
    <>
      <EnTete />
      <main className="page-legale">
        <PageLegaleVue page={CONFIDENTIALITE} ebauche={!pagesLegalesValidees()} />
      </main>
      <PiedDePage />
    </>
  );
}
