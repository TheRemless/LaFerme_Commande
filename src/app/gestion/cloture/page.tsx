import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { ClotureJour } from "@/components/gestion/ClotureJour";

export const metadata: Metadata = { title: titreRubrique("/gestion/cloture") };

export default function Page() {
  return <ClotureJour />;
}
