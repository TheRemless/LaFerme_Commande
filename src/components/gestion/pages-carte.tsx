"use client";

import { useState } from "react";
import { GestionCarte, GestionPlatDuJour, GestionSupplements } from "@/components/gestion/GestionCarte";
import { ListeCarte } from "@/components/gestion/carte/ListeCarte";
import { Onglets } from "@/components/gestion/ui";
import { GestionImport } from "@/components/gestion/GestionImport";
import { useCarte } from "@/components/gestion/contexte-carte";

// Les rubriques qui lisent la carte chargée par la coque (contexte-carte.tsx).
function Chargement() {
  const { erreur, recharger } = useCarte();
  if (!erreur) return <p className="aide">Chargement…</p>;
  return (
    <div className="panier-alerte" role="alert">
      <p>{erreur}</p>
      <button type="button" className="bouton-second" onClick={() => recharger()}>
        Réessayer
      </button>
    </div>
  );
}

// Carte : la liste dense (par défaut) et la vue par catégorie (ordre des plats, catégories, archives).
export function PageCarte() {
  const { carte, recharger, version } = useCarte();
  const [vue, setVue] = useState("liste");
  if (!carte) return <Chargement />;
  return (
    <Onglets
        libelle="Vues de la carte"
        onglets={[
          { cle: "liste", titre: "Liste" },
          { cle: "categories", titre: "Par catégorie et ordre" },
        ]}
        actif={vue}
        onChange={setVue}
      >
        {vue === "liste" ? (
          <ListeCarte donnees={carte} recharger={recharger} version={version} />
        ) : (
          <GestionCarte donnees={carte} recharger={recharger} version={version} />
        )}
    </Onglets>
  );
}

export function PagePlatDuJour() {
  const { carte, recharger } = useCarte();
  return carte ? <GestionPlatDuJour donnees={carte} recharger={recharger} /> : <Chargement />;
}

export function PageSupplements() {
  const { carte, recharger } = useCarte();
  return carte ? <GestionSupplements donnees={carte} recharger={recharger} /> : <Chargement />;
}

export function PageImport() {
  const { apresImport } = useCarte();
  return <GestionImport recharger={apresImport} />;
}
