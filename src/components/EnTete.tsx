import Image from "next/image";
import Link from "next/link";

export function EnTete() {
  return (
    <header className="tete">
      <Link className="logo" href="/">
        <Image src="/logo-la-ferme.png" alt="La Ferme, accueil" width={829} height={250} priority />
      </Link>
    </header>
  );
}
