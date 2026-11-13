import type { Metadata } from "next";
import { GestionService } from "@/components/gestion/GestionService";

export const metadata: Metadata = { title: "Livraison et horaires" };

export default function Page() {
  return <GestionService />;
}
