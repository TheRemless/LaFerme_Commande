import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { PagePlatDuJour } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: titreRubrique("/gestion/plat-du-jour") };

export default function Page() {
  return <PagePlatDuJour />;
}
