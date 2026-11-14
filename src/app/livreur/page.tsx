import type { Metadata, Viewport } from "next";
import { Livreur } from "@/components/livreur/Livreur";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { connexionParCodeActive } from "@/lib/personnel/code-livreur";
import { peutLivrer } from "@/lib/livreur";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Livraisons, La Ferme", robots: PRIVE };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Téléphone du livreur : ses livraisons en cours, rien d'autre. Même connexion par code que l'équipe.
export default async function PageLivreur() {
  const personnel = await personnelCourant();
  // Le gérant, ou le responsable au rôle ouvert, peut livrer avec son propre compte (réponse de Jérémy du 14.11).
  const livre = !!personnel && (personnel.role === "livreur" || (await peutLivrer(personnel)));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return (
    <main id="contenu" className="page-livreur">
      {!personnel ? (
        <ConnexionPersonnel titre="Livraisons de La Ferme" codeLivreur={await connexionParCodeActive()} />
      ) : !livre ? (
        <div className="connexion connexion-personnel">
          <h1>Livraisons de La Ferme</h1>
          <p>Cette page est celle des livreurs. Votre compte donne accès à la tablette.</p>
          <a className="bouton-second" href="/tablette">
            Ouvrir la tablette
          </a>
        </div>
      ) : (
        <Livreur nom={personnel.nom} supabase={url && cle ? { url, cle } : null} />
      )}
    </main>
  );
}
