import type { Metadata } from "next";
import { PageSupplements } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: "Suppléments et pâtes" };

export default function Page() {
  return <PageSupplements />;
}
