import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PageLegaleVue } from "@/components/legal/PageLegaleVue";
import { PiedDePage } from "@/components/PiedDePage";
import { pagesLegalesValidees, pagesLegalesVisibles } from "@/lib/legal/acces";
import { MENTIONS } from "@/lib/legal/mentions";

export const metadata: Metadata = { title: "Mentions légales, La Ferme" };

export default function Page() {
  if (!pagesLegalesVisibles()) notFound();
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
