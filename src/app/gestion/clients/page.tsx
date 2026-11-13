import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionClients } from "@/components/gestion/clients/GestionClients";

export const metadata: Metadata = { title: titreRubrique("/gestion/clients") };

export default function Page() {
  return <GestionClients />;
}
