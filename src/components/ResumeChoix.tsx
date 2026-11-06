"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { lireChoix, type Choix } from "@/lib/choix";
import { heureTexte, jourTexte } from "@/lib/service";

// Rappel du mode, de l'adresse et de l'heure en haut de la carte. Sans choix, retour à l'accueil :
// le client choisit livraison ou retrait avant de voir les plats (docs/PROMPT.md §2).
export function ResumeChoix() {
  const router = useRouter();
  const [choix, setChoix] = useState<Choix | null | undefined>(undefined);

  useEffect(() => {
    const c = lireChoix();
    setChoix(c);
    if (!c) router.replace("/");
  }, [router]);

  if (!choix) return null;
  const quand =
    choix.quand.type === "asap"
      ? "dès que possible"
      : choix.quand.type === "creneau"
        ? `${jourTexte(choix.quand.date)}, ${heureTexte(choix.quand.minutes)}`
        : "commande en ligne fermée";
  return (
    <Link className="tete-mode" href="/">
      <strong>
        {choix.mode === "livraison" ? "Livraison" : "À emporter"}, {quand}
      </strong>
      <span>
        {choix.mode === "livraison" && choix.adresse
          ? `${choix.adresse.rue}${choix.adresse.numero ? ` ${choix.adresse.numero}` : ""}, ${choix.adresse.localite}`
          : "Route de Chancy 132, Onex"}
      </span>
    </Link>
  );
}
