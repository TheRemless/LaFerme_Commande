import type { Metadata } from "next";
import { PageCarte } from "@/components/gestion/pages-carte";

export const metadata: Metadata = { title: "Carte" };

export default function Page() {
  return <PageCarte />;
}
