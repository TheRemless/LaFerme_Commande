import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionExport } from "@/components/gestion/GestionExport";

export const metadata: Metadata = { title: titreRubrique("/gestion/export") };

export default function Page() {
  return <GestionExport />;
}
