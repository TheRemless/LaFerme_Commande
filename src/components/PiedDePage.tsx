import Link from "next/link";
import { pageLegalePubliable } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";
import { CONFIDENTIALITE } from "@/lib/legal/confidentialite";
import { MENTIONS } from "@/lib/legal/mentions";

// Pied de page des pages clients : qui vend (LCD art. 3 al. 1 let. s) et liens vers les pages légales,
// qui n'apparaissent en production qu'une fois validées.
export function PiedDePage() {
  const liens = [MENTIONS, CGV, CONFIDENTIALITE].every(pageLegalePubliable);
  return (
    <footer className="pied">
      <p>
        Restaurant La Ferme, Route de Chancy 132, 1213 Onex. <a href="tel:+41227921689">022 792 16 89</a>
      </p>
      {liens && (
        <nav aria-label="Informations légales">
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/cgv">Conditions générales</Link>
          <Link href="/confidentialite">Confidentialité</Link>
        </nav>
      )}
    </footer>
  );
}
