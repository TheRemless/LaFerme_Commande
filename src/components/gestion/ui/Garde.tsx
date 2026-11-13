"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef } from "react";
import { useConfirmer } from "@/components/gestion/ui/Confirmation";

// Garde des modifications non enregistrées. Un formulaire déclare useGardeModifications(modifie) ;
// la coque demande confirmation avant de changer de rubrique, et le navigateur avant de fermer l'onglet.
// Le panneau latéral (PanneauLateral) ouvre une portée à lui (PorteeGarde) : en se fermant, il ne demande
// que pour ses propres champs et n'efface que leurs marques.

type Garde = {
  declarer: (id: string, modifie: boolean) => void;
  /** true si on peut partir (rien de modifié, ou le gérant accepte de perdre ses saisies). */
  peutPartir: () => Promise<boolean>;
};

const TEXTE_GARDE = {
  titre: "Quitter sans enregistrer ?",
  texte: "Vos changements sur cette page seront perdus.",
  oui: "Quitter sans enregistrer",
  non: "Rester sur la page",
  danger: true,
} as const;

const Contexte = createContext<Garde | null>(null);

export function FournisseurGarde({ children }: { children: React.ReactNode }) {
  const modifies = useRef(new Set<string>());
  const confirmer = useConfirmer();

  const declarer = useCallback((id: string, modifie: boolean) => {
    if (modifie) modifies.current.add(id);
    else modifies.current.delete(id);
  }, []);

  const peutPartir = useCallback(async () => {
    if (modifies.current.size === 0) return true;
    const ok = await confirmer(TEXTE_GARDE);
    if (ok) modifies.current.clear();
    return ok;
  }, [confirmer]);

  useEffect(() => {
    const avant = (e: BeforeUnloadEvent) => {
      if (modifies.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, []);

  const valeur = useMemo(() => ({ declarer, peutPartir }), [declarer, peutPartir]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** Portée d'un panneau : ses champs comptent pour la page entière, mais le panneau ne demande que pour eux. */
export function PorteeGarde({ children }: { children: React.ReactNode }) {
  const parent = useContext(Contexte);
  const miens = useRef(new Set<string>());
  const confirmer = useConfirmer();
  const declarer = useCallback(
    (id: string, modifie: boolean) => {
      if (modifie) miens.current.add(id);
      else miens.current.delete(id);
      parent?.declarer(id, modifie);
    },
    [parent],
  );
  const peutPartir = useCallback(async () => {
    if (miens.current.size === 0) return true;
    const ok = await confirmer({ ...TEXTE_GARDE, texte: "Vos changements dans cette fiche seront perdus." });
    if (ok) for (const id of [...miens.current]) declarer(id, false);
    return ok;
  }, [confirmer, declarer]);
  const valeur = useMemo(() => ({ declarer, peutPartir }), [declarer, peutPartir]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** À appeler dans un formulaire : useGardeModifications(valeurs !== initiales). */
export function useGardeModifications(modifie: boolean) {
  const g = useContext(Contexte);
  const id = useId();
  useEffect(() => {
    g?.declarer(id, modifie);
  }, [g, id, modifie]);
  useEffect(() => () => g?.declarer(id, false), [g, id]);
}

/** Pour la coque et le panneau : demander avant de partir. Sans fournisseur, on part toujours. */
export function usePeutPartir(): () => Promise<boolean> {
  const g = useContext(Contexte);
  return useMemo(() => g?.peutPartir ?? (async () => true), [g]);
}
