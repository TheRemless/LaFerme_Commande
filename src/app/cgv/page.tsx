import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PageLegaleVue } from "@/components/legal/PageLegaleVue";
import { PiedDePage } from "@/components/PiedDePage";
import { pagesLegalesValidees, pagesLegalesVisibles } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";

export const metadata: Metadata = { title: "Conditions générales, La Ferme" };

export default function Page() {
  if (!pagesLegalesVisibles()) notFound();
  return (
    <>
      <EnTete />
      <main className="page-legale">
        <PageLegaleVue page={CGV} ebauche={!pagesLegalesValidees()} />
      </main>
      <PiedDePage />
    </>
  );
}
