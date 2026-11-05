import { redirect } from "next/navigation";

// L'accueil (mode et adresse avant la carte) arrive au lot 3.
export default function Accueil() {
  redirect("/carte");
}
