import type { Metadata } from "next";
import { GestionReglages } from "@/components/gestion/GestionReglages";
import { ReglagesFidelite } from "@/components/gestion/ReglagesFidelite";
import { titreRubrique } from "@/components/gestion/navigation";

export const metadata: Metadata = { title: titreRubrique("/gestion/reglages") };

export default function Page() {
  return (
    <>
      <GestionReglages />
      {/* Cagnotte des clients (vague 3, client-compte) : son propre formulaire, sous les réglages généraux. */}
      <ReglagesFidelite />
    </>
  );
}
