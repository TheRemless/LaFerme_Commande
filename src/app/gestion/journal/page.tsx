import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionJournal } from "@/components/gestion/GestionJournal";

export const metadata: Metadata = { title: titreRubrique("/gestion/journal") };

export default function Page() {
  return <GestionJournal />;
}
