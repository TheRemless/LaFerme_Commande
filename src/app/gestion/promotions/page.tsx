import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionPromotions } from "@/components/gestion/carte/Promotions";

export const metadata: Metadata = { title: titreRubrique("/gestion/promotions") };

export default function Page() {
  return <GestionPromotions />;
}
