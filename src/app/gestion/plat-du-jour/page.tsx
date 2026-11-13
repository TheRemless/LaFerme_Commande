import type { Metadata } from "next";
import { PagePlatDuJour } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: "Plat du jour" };

export default function Page() {
  return <PagePlatDuJour />;
}
