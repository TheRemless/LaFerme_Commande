import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionImprimantes } from "@/components/gestion/GestionImprimantes";

export const metadata: Metadata = { title: titreRubrique("/gestion/imprimantes") };

export default function Page() {
  return <GestionImprimantes />;
}
