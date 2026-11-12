"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { lirePlatsRemis, usePanier, usePrixServeur } from "@/lib/panier-local";
import { ContenuPanier } from "@/components/panier/ContenuPanier";

export function PagePanier({ catalogue, preversion }: { catalogue: Catalogue; preversion: boolean }) {
  const panier = usePanier();
  const { lignes, charge, quantite } = panier;
  const reponse = usePrixServeur(lignes, charge);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [remis, setRemis] = useState(0);
  useEffect(() => {
    setChoix(lireChoix());
    setRemis(lirePlatsRemis());
  }, []);
  return (
    <div className="panier-page">
      <Link className="retour" href="/carte">
        ‹ Carte
      </Link>
      <h1 className="panier-titre">Votre commande</h1>
      {remis > 0 && (
        <p className="panier-vide" role="status">
          {remis === 1 ? "1 plat remis" : `${remis} plats remis`} dans votre panier.
        </p>
      )}
      {charge && <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} suivi={panier} />}
      <Link className="lien-retour" href="/carte">
        Ajouter d&apos;autres plats
      </Link>
    </div>
  );
}
