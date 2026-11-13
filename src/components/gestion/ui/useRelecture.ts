"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Relecture en direct d'une liste du back-office (commandes du jour, accueil). Règles :
// - relit toutes les `intervalleMs` tant que l'onglet est visible, et tout de suite au retour sur l'onglet ;
// - n'envoie pas une requête tant que la précédente n'est pas revenue ;
// - la dernière demande gagne : une réponse arrivée après une demande plus récente est jetée (PR #72,
//   la liste du jour qui écrasait une recherche) ;
// - une erreur garde les dernières données et le dit (`erreur`), sans vider l'écran.
// const { donnees, erreur, recharger, majLe } = useRelecture(async (signal) => lireListe(filtres, signal), [filtres], { intervalleMs: 15_000 });

export type Relecture<T> = {
  donnees: T | null;
  erreur: string | null;
  /** Heure (ISO) de la dernière réponse reçue. */
  majLe: string | null;
  chargement: boolean;
  /** Relire tout de suite (après une action, ou « Réessayer »). */
  recharger: () => void;
};

export function useRelecture<T>(
  lire: (signal: AbortSignal) => Promise<T>,
  dependances: unknown[],
  { intervalleMs = 15_000, actif = true, messageErreur = "Pas de mise à jour. Vérifiez le réseau." }: { intervalleMs?: number; actif?: boolean; messageErreur?: string } = {},
): Relecture<T> {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majLe, setMajLe] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const sequence = useRef(0);
  const enVol = useRef<AbortController | null>(null);
  const lireRef = useRef(lire);
  lireRef.current = lire;

  // `force` : une nouvelle demande (filtres changés, action faite) annule celle en vol ;
  // le minuteur, lui, ne double jamais une requête en cours.
  const relire = useCallback(
    async (force: boolean) => {
      if (enVol.current && !force) return;
      enVol.current?.abort();
      const controleur = new AbortController();
      enVol.current = controleur;
      const n = ++sequence.current;
      setChargement(true);
      try {
        const r = await lireRef.current(controleur.signal);
        if (n !== sequence.current) return;
        setDonnees(r);
        setErreur(null);
        setMajLe(new Date().toISOString());
      } catch (e) {
        if (n !== sequence.current || controleur.signal.aborted) return;
        setErreur(e instanceof Error && e.message ? e.message : messageErreur);
      } finally {
        if (n === sequence.current) {
          setChargement(false);
          enVol.current = null;
        }
      }
    },
    [messageErreur],
  );

  // Nouvelle demande dès que les dépendances (filtres, page) changent de valeur.
  const cle = JSON.stringify(dependances);
  useEffect(() => {
    if (actif) relire(true);
  }, [actif, relire, cle]);

  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => document.visibilityState === "visible" && relire(false), intervalleMs);
    const vu = () => document.visibilityState === "visible" && relire(false);
    document.addEventListener("visibilitychange", vu);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vu);
    };
  }, [actif, intervalleMs, relire]);

  useEffect(() => () => enVol.current?.abort(), []);

  const recharger = useCallback(() => void relire(true), [relire]);
  return { donnees, erreur, majLe, chargement, recharger };
}
