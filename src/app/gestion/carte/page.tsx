import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { PageCarte } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: titreRubrique("/gestion/carte") };

export default function Page() {
  return <PageCarte />;
}
