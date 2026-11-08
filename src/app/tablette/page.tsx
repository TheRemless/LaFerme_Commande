import type { Metadata } from "next";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { Tablette } from "@/components/tablette/Tablette";
import { personnelCourant } from "@/lib/personnel/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tablette, La Ferme", robots: { index: false, follow: false } };

export default async function PageTablette() {
  const personnel = await personnelCourant();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return (
    <main id="contenu" className="page-tablette">
      {personnel ? <Tablette nom={personnel.nom} supabase={url && cle ? { url, cle } : null} /> : <ConnexionPersonnel />}
    </main>
  );
}
