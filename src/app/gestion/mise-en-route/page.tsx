import type { Metadata } from "next";
import { PageMiseEnRoute } from "@/components/gestion/MiseEnRoute";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/mise-en-route") };

export default function Page() {
  return <PageMiseEnRoute />;
}
