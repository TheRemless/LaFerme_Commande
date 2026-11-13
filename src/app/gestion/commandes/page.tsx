import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionCommandes } from "@/components/gestion/GestionCommandes";

export const metadata: Metadata = { title: titreRubrique("/gestion/commandes") };

export default function Page() {
  return <GestionCommandes />;
}
