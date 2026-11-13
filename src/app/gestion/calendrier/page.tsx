import type { Metadata } from "next";
import { GestionCalendrier } from "@/components/gestion/GestionCalendrier";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/calendrier") };

export default function Page() {
  return <GestionCalendrier />;
}
