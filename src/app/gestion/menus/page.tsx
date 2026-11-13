import type { Metadata } from "next";
import { titreRubrique } from "@/components/gestion/navigation";
import { GestionMenus } from "@/components/gestion/carte/Menus";

export const metadata: Metadata = { title: titreRubrique("/gestion/menus") };

export default function Page() {
  return <GestionMenus />;
}
