import type { Metadata } from "next";
import { GestionEquipe } from "@/components/gestion/GestionEquipe";

export const metadata: Metadata = { title: "Équipe" };

export default function Page() {
  return <GestionEquipe />;
}
