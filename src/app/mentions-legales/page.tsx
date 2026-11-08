import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PageLegaleVue } from "@/components/legal/PageLegaleVue";
import { PiedDePage } from "@/components/PiedDePage";
import { pageLegalePubliable, pagesLegalesValidees } from "@/lib/legal/acces";
import { MENTIONS } from "@/lib/legal/mentions";

// Lue à chaque requête : poser PAGES_LEGALES_VALIDEES sur Netlify suffit, sans rebâtir le site.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mentions légales, La Ferme" };

export default function Page() {
  if (!pageLegalePubliable(MENTIONS)) notFound();
  return (
    <>
      <EnTete />
      <main className="page-legale">
        <PageLegaleVue page={MENTIONS} ebauche={!pagesLegalesValidees()} />
      </main>
      <PiedDePage />
    </>
  );
}
