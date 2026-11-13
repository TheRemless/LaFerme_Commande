import type { Metadata } from "next";
import { GestionExport } from "@/components/gestion/GestionExport";

export const metadata: Metadata = { title: "Export comptable" };

export default function Page() {
  return <GestionExport />;
}
