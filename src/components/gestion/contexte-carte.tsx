"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DonneesCarte } from "@/components/gestion/GestionCarte";

// La carte du back-office, chargée une fois par la coque et gardée d'une rubrique à l'autre
// (Carte, Plat du jour, Suppléments, Import, et le compteur « plats bloquants » de la navigation).
type ValeurCarte = {
  carte: DonneesCarte | null;
  /** Dernier chargement raté (coupure, serveur) : la page le dit et propose de réessayer. */
  erreur: string | null;
  recharger: () => Promise<void>;
  /** Change à chaque import appliqué : les fiches ouvertes repartent alors des nouvelles valeurs. */
  version: number;
  apresImport: () => Promise<void>;
};

const Contexte = createContext<ValeurCarte | null>(null);

export function FournisseurCarte({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [carte, setCarte] = useState<DonneesCarte | null>(null);
  const [version, setVersion] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    const rep = await fetch("/api/gestion/carte", { cache: "no-store" }).catch(() => null);
    if (!rep) return setErreur("Pas de connexion. Vérifiez le réseau et réessayez.");
    if (rep.status === 401) return router.refresh();
    if (!rep.ok) return setErreur("La carte n'a pas pu être chargée. Réessayez.");
    setErreur(null);
    setCarte(await rep.json());
  }, [router]);

  useEffect(() => {
    recharger();
  }, [recharger]);

  const apresImport = useCallback(async () => {
    setVersion((v) => v + 1);
    await recharger();
  }, [recharger]);

  const valeur = useMemo(() => ({ carte, erreur, recharger, version, apresImport }), [carte, erreur, recharger, version, apresImport]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useCarte(): ValeurCarte {
  const v = useContext(Contexte);
  if (!v) throw new Error("useCarte hors du back-office");
  return v;
}
