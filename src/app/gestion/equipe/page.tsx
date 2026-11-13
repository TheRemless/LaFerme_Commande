import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionEquipe } from "@/components/gestion/GestionEquipe";

export const metadata: Metadata = { title: titreRubrique("/gestion/equipe") };

export default function Page() {
  return <GestionEquipe />;
}
