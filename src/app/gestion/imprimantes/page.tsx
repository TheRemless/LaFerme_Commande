import type { Metadata } from "next";
import { GestionImprimantes } from "@/components/gestion/GestionImprimantes";

export const metadata: Metadata = { title: "Imprimantes" };

export default function Page() {
  return <GestionImprimantes />;
}
