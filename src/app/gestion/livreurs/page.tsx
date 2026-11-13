import type { Metadata } from "next";
import { GestionLivreurs } from "@/components/gestion/GestionLivreurs";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/livreurs") };

export default function Page() {
  return <GestionLivreurs />;
}
