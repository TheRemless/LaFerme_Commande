import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { Rapports } from "@/components/gestion/Rapports";

export const metadata: Metadata = { title: titreRubrique("/gestion/rapports") };

export default function Page() {
  return <Rapports />;
}
