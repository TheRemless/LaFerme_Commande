import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icone } from "@/components/Icone";

export function EnTete({ children }: { children?: ReactNode }) {
  return (
    <header className="tete">
      <Link className="logo" href="/">
        {/* Affiché sur 40 px de haut au plus (globals.css) : le navigateur prend un fichier de 256 ou 384 px. */}
        <Image src="/logo-la-ferme.png" alt="La Ferme, accueil" width={133} height={40} priority />
      </Link>
      {children}
      <Link className="tete-compte" href="/compte">
        <Icone nom="compte" />
        <span className="tete-compte-txt">Compte</span>
      </Link>
    </header>
  );
}
