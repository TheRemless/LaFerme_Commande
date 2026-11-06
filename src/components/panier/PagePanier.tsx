"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { usePanier, usePrixServeur } from "@/lib/panier-local";
import { ContenuPanier } from "@/components/panier/ContenuPanier";

export function PagePanier({ catalogue, preversion }: { catalogue: Catalogue; preversion: boolean }) {
  const { lignes, charge, quantite } = usePanier();
  const reponse = usePrixServeur(lignes, charge);
  const [choix, setChoix] = useState<Choix | null>(null);
  useEffect(() => setChoix(lireChoix()), []);
  return (
    <div className="panier-page">
      <Link className="retour" href="/carte">
        ‹ Carte
      </Link>
      <h1 className="panier-titre">Votre commande</h1>
      {charge && <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} />}
      <Link className="lien-retour" href="/carte">
        Ajouter d&apos;autres plats
      </Link>
    </div>
  );
}
