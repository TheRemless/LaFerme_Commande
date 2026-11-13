import type { Metadata } from "next";
import { GestionJournal } from "@/components/gestion/GestionJournal";

export const metadata: Metadata = { title: "Journal" };

export default function Page() {
  return <GestionJournal />;
}
