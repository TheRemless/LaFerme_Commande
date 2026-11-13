"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef } from "react";
import { useConfirmer } from "@/components/gestion/ui/Confirmation";

// Garde des modifications non enregistrées. Un formulaire déclare useGardeModifications(modifie) ;
// la coque demande confirmation avant de changer de rubrique, et le navigateur avant de fermer l'onglet.
// Le panneau latéral (PanneauLateral) la consulte aussi avant de se fermer.

type Garde = {
  declarer: (id: string, modifie: boolean) => void;
  /** true si on peut partir (rien de modifié, ou le gérant accepte de perdre ses saisies). */
  peutPartir: () => Promise<boolean>;
};

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
    const ok = await confirmer({
      titre: "Quitter sans enregistrer ?",
      texte: "Vos changements sur cette page seront perdus.",
      oui: "Quitter sans enregistrer",
      non: "Rester sur la page",
      danger: true,
    });
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
