import Link from "next/link";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";

// Page introuvable en français (lien de suivi inconnu, page légale pas encore publiée…).
export default function Introuvable() {
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-legale">
        <div className="legal">
          <h1>Page introuvable</h1>
          <p>Cette adresse ne mène à aucune page du site.</p>
          <p>
            <Link className="lien" href="/">
              Revenir à l&apos;accueil
            </Link>
          </p>
          <p>
            Une question sur une commande&nbsp;? Appelez-nous au <a href="tel:+41227921689">022&nbsp;792&nbsp;16&nbsp;89</a>.
          </p>
        </div>
      </main>
      <PiedDePage />
    </>
  );
}
