import { redirect } from "next/navigation";
import { AccueilGestion } from "@/components/gestion/AccueilGestion";
import { personnelCourant } from "@/lib/personnel/session";

// L'accueil montre les ventes : réservé au gérant. Un responsable de service (D1) arrive sur les commandes.
export default async function PageAccueilGestion() {
  if ((await personnelCourant())?.role === "responsable") redirect("/gestion/commandes");
  return <AccueilGestion />;
}
