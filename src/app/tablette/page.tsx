import type { Metadata } from "next";
import { ConnexionPersonnel } from "@/components/tablette/ConnexionPersonnel";
import { Tablette } from "@/components/tablette/Tablette";
import { fonctionSql } from "@/lib/db/serveur";
import { personnelCourant } from "@/lib/personnel/session";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
// Manifeste à part : ajoutée à l'écran d'accueil, la tablette s'ouvre en plein écran sur /tablette.
export const metadata: Metadata = { title: "Tablette, La Ferme", robots: PRIVE, manifest: "/tablette.webmanifest" };

export default async function PageTablette() {
  const personnel = await personnelCourant();
  // Commandes au back-office (lien du bandeau des remboursements) : gérant, ou responsable au rôle ouvert.
  const backOffice =
    personnel && personnel.role !== "livreur" ? await fonctionSql<boolean>("droit_personnel", { p_personnel: personnel.id, p_action: "voir_commandes" }) : false;
  // Annuler une livraison partie : gérant, ou responsable de service au rôle ouvert (D1). Pour l'écran seulement,
  // le serveur revérifie (droit_personnel, puis auteur_droit en base).
  const annulerPartie =
    personnel && personnel.role !== "livreur" ? await fonctionSql<boolean>("droit_personnel", { p_personnel: personnel.id, p_action: "annuler_apres_prete" }) : false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return (
    <main id="contenu" className="page-tablette">
      {!personnel ? (
        <ConnexionPersonnel />
      ) : personnel.role === "livreur" ? (
        // Un livreur ne voit que ses livraisons, sur son téléphone : pas la file du restaurant.
        <div className="connexion connexion-personnel">
          <h1>Tablette du restaurant</h1>
          <p>Votre compte est celui d&apos;un livreur. Vos livraisons sont sur une autre page.</p>
          <a className="bouton-principal" href="/livreur">
            Mes livraisons
          </a>
        </div>
      ) : (
        <Tablette nom={personnel.nom} annulerPartie={annulerPartie} backOffice={backOffice} supabase={url && cle ? { url, cle } : null} />
      )}
    </main>
  );
}
