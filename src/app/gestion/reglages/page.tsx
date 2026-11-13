import type { Metadata } from "next";
import { GestionReglages } from "@/components/gestion/GestionReglages";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/reglages") };

export default function Page() {
  return <GestionReglages />;
}
