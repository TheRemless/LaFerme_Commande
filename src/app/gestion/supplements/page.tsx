import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { PageSupplements } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: titreRubrique("/gestion/supplements") };

export default function Page() {
  return <PageSupplements />;
}
