import Link from "next/link";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";

// Lien de suivi inconnu ou abîmé : on dit ce qui manque et où retrouver le bon lien (audit design, D24).
export default function SuiviIntrouvable() {
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-legale">
        <div className="legal">
          <h1>Commande introuvable</h1>
          <p>Ce lien de suivi ne correspond à aucune commande. Le bon lien est dans l&apos;e-mail de confirmation de votre commande.</p>
          <p>
            <Link className="lien" href="/">
              Revenir à l&apos;accueil
            </Link>
          </p>
          <p>
            Une question sur une commande&nbsp;? <span className="sans-coupure">Appelez-nous</span> au{" "}
            <a href="tel:+41227921689">022&nbsp;792&nbsp;16&nbsp;89</a>.
          </p>
        </div>
      </main>
      <PiedDePage />
    </>
  );
}
