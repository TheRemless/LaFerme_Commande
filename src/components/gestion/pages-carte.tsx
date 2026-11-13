"use client";

import { GestionCarte, GestionPlatDuJour, GestionSupplements } from "@/components/gestion/GestionCarte";
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

export function PageCarte() {
  const { carte, recharger, version } = useCarte();
  return carte ? <GestionCarte donnees={carte} recharger={recharger} version={version} /> : <Chargement />;
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
