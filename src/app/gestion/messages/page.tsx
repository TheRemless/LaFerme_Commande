import type { Metadata } from "next";
import { GestionMessages } from "@/components/gestion/GestionMessages";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/messages") };

export default function Page() {
  return <GestionMessages />;
}
