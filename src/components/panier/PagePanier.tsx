"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LignePlat } from "@/lib/carte";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { lirePlatsRemis, usePanier, useCalculPanier } from "@/lib/panier-local";
import { ContenuPanier } from "@/components/panier/ContenuPanier";
import { FichePlat } from "@/components/carte/FichePlat";
import { suggestionPanier, type DonneesPopulaires } from "@/lib/suggestion";

export function PagePanier({
  catalogue,
  plats,
  preversion,
  populaires,
}: {
  catalogue: Catalogue;
  plats: LignePlat[];
  preversion: boolean;
  populaires?: DonneesPopulaires;
}) {
  const panier = usePanier();
  const { lignes, charge, quantite, remplacer, ajouter } = panier;
  // Ligne rouverte dans sa fiche (« Modifier ») : options, retraits, note et quantité sans repartir de zéro.
  const [edition, setEdition] = useState<{ index: number; plat: LignePlat } | null>(null);
  // Annoncé aux lecteurs d'écran, la fiche se ferme sans autre signe.
  const [annonce, setAnnonce] = useState("");
  const fermer = useCallback(() => setEdition(null), []);
  const modifier = useCallback(
    (i: number) => {
      const plat = plats.find((p) => p.slug === lignes[i]?.slug);
      if (plat) setEdition({ index: i, plat });
    },
    [plats, lignes],
  );
  const calcul = useCalculPanier(lignes, charge);
  const { reponse } = calcul;
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
      {charge && (
        <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} suivi={panier} calcul={calcul} onModifier={modifier}
          suggestion={suggestionPanier(populaires, lignes, catalogue, plats)}
          onSuggestion={(slug) => ajouter({ slug, qte: 1, choix: {}, retraits: [], note: "" })}
        />
      )}
      <Link className="lien-retour" href="/carte">
        Ajouter d&apos;autres plats
      </Link>
      <p className="sr-only" role="status">
        {annonce}
      </p>
      {edition && lignes[edition.index] && (
        <FichePlat
          plat={edition.plat}
          catalogue={catalogue}
          preversion={preversion}
          ferme={choix?.quand.type === "aucun"}
          initiale={lignes[edition.index]}
          onAjouter={(ligne) => {
            remplacer(edition.index, ligne);
            setAnnonce("Ligne mise à jour dans le panier.");
          }}
          onFermer={fermer}
        />
      )}
    </div>
  );
}
