import type { Metadata } from "next";
import { PageImport } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: "Importer le tableau" };

export default function Page() {
  return <PageImport />;
}
