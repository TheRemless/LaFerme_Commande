import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { VuePoste } from "@/components/tablette/VuePoste";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";
import "@/components/tablette/tablette.css";
import "@/components/tablette/poste.css";

// Vue par poste (vague 3, décision D12 à l'essai) : derrière un lien, pas dans le menu de la tablette.
// /tablette/poste/pizza et /tablette/poste/cuisine, même connexion que la tablette.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Poste, La Ferme", robots: PRIVE };

export default async function PagePoste({ params }: { params: Promise<{ station: string }> }) {
  const { station } = await params;
  if (station !== "pizza" && station !== "cuisine") notFound();
  const personnel = await personnelCourant();
  return (
    <main id="contenu" className="page-tablette page-poste">
      {!personnel || personnel.role === "livreur" ? <ConnexionPersonnel /> : <VuePoste station={station} />}
    </main>
  );
}
