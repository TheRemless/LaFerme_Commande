import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function EnTete({ children }: { children?: ReactNode }) {
  return (
    <header className="tete">
      <Link className="logo" href="/">
        <Image src="/logo-la-ferme.png" alt="La Ferme, accueil" width={829} height={250} priority />
      </Link>
      {children}
      <Link className="tete-compte" href="/compte">
        Compte
      </Link>
    </header>
  );
}
