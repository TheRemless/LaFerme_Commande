import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { PageImport } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: titreRubrique("/gestion/import") };

export default function Page() {
  return <PageImport />;
}
