"use client";

import { useEffect, useRef } from "react";

// Ouvrir une fiche en arrivant sur une rubrique (recherche globale, accueil, alertes), sans mettre un e-mail
// ou un nom dans l'adresse : la cible passe par le stockage de la session du navigateur, lue une fois.
// Côté rubrique : useOuverture("client", (email) => setOuvert(email)).
export type CibleOuverture = { type: "commande" | "client" | "plat" | "reclamation"; cle: string };

const CLE = "laferme.gestion.ouvrir";
const VALIDITE_MS = 30_000;

export function demanderOuverture(c: CibleOuverture): void {
  try {
    sessionStorage.setItem(CLE, JSON.stringify({ ...c, le: Date.now() }));
  } catch {}
}

export function useOuverture(type: CibleOuverture["type"], ouvrir: (cle: string) => void): void {
  const derniere = useRef(ouvrir);
  derniere.current = ouvrir;
  useEffect(() => {
    try {
      const brut = sessionStorage.getItem(CLE);
      if (!brut) return;
      const c = JSON.parse(brut) as CibleOuverture & { le: number };
      if (c.type !== type) return;
      sessionStorage.removeItem(CLE);
      if (Date.now() - c.le < VALIDITE_MS && typeof c.cle === "string") derniere.current(c.cle);
    } catch {}
  }, [type]);
}
