import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PageLegaleVue } from "@/components/legal/PageLegaleVue";
import { PiedDePage } from "@/components/PiedDePage";
import { pageLegalePubliable, pagesLegalesValidees } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";

// Lue à chaque requête : poser PAGES_LEGALES_VALIDEES sur Netlify suffit, sans rebâtir le site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conditions générales, La Ferme" };

export default function Page() {
  if (!pageLegalePubliable(CGV)) notFound();
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-legale">
        <PageLegaleVue page={CGV} ebauche={!pagesLegalesValidees()} />
      </main>
      <PiedDePage />
    </>
  );
}
