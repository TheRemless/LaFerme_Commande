import type { Metadata } from "next";
import { GestionParrainages } from "@/components/gestion/GestionParrainages";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/parrainages") };

export default function Page() {
  return <GestionParrainages />;
}
