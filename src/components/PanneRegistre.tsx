"use client";

import Link from "next/link";
import type { Choix } from "@/lib/choix";
import { MESSAGE_REGISTRE_EN_PANNE, passerAEmporter } from "@/lib/registre-panne";

// Message de panne du service fédéral des adresses, au panier et au paiement : le numéro se touche pour
// appeler, et « Commander à emporter » passe le choix à emporter (l'accueil montre l'heure du retrait).
const NUMERO = "022 792 16 89";
const [AVANT, APRES] = MESSAGE_REGISTRE_EN_PANNE.split(NUMERO);

export function PanneRegistre({ choix }: { choix: Choix | null }) {
  return (
    <>
      {AVANT}
      <a href="tel:+41227921689" className="sans-coupure">
        {NUMERO}
      </a>
      {APRES}{" "}
      <Link href="/" onClick={() => passerAEmporter(choix)}>
        Commander à emporter
      </Link>
    </>
  );
}
