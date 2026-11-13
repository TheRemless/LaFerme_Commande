import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionService } from "@/components/gestion/GestionService";

export const metadata: Metadata = { title: titreRubrique("/gestion/horaires") };

export default function Page() {
  return <GestionService />;
}
