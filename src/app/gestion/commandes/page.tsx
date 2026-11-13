import type { Metadata } from "next";
import { GestionCommandes } from "@/components/gestion/GestionCommandes";

export const metadata: Metadata = { title: "Commandes" };

export default function Page() {
  return <GestionCommandes />;
}
