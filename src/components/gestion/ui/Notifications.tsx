"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconeGestion } from "@/components/gestion/ui/icones";

// Notifications du back-office : un message court en bas de l'écran après une action, avec « Annuler »
// quand l'action se défait. Elles ne prennent jamais le focus. Lues par les lecteurs d'écran
// (poli pour une réussite, tout de suite pour une erreur). Une erreur reste jusqu'à ce qu'on la ferme.

export type Ton = "succes" | "info" | "erreur";
export type Notification = {
  texte: string;
  ton?: Ton;
  /** Défaire l'action. Le bouton « Annuler » reste le temps de la notification. */
  annuler?: () => void | Promise<void>;
  /** Millisecondes. 6000 par défaut, 10000 avec « Annuler », sans fin pour une erreur. */
  duree?: number;
};
type Active = Notification & { id: number };

const Contexte = createContext<((n: Notification) => void) | null>(null);

export function FournisseurNotifications({ children }: { children: React.ReactNode }) {
  const [liste, setListe] = useState<Active[]>([]);
  const suivant = useRef(1);

  const retirer = useCallback((id: number) => setListe((l) => l.filter((x) => x.id !== id)), []);
  const notifier = useCallback((n: Notification) => {
    const id = suivant.current++;
    // Trois au plus à l'écran : la plus ancienne s'en va.
    setListe((l) => [...l.slice(-2), { ...n, id }]);
  }, []);

  return (
    <Contexte.Provider value={notifier}>
      {children}
      <div className="bo-notifs" aria-live="polite" aria-relevant="additions">
        {liste
          .filter((n) => n.ton !== "erreur")
          .map((n) => (
            <Bulle key={n.id} n={n} retirer={retirer} />
          ))}
      </div>
      <div className="bo-notifs bo-notifs-erreurs" role="alert">
        {liste
          .filter((n) => n.ton === "erreur")
          .map((n) => (
            <Bulle key={n.id} n={n} retirer={retirer} />
          ))}
      </div>
    </Contexte.Provider>
  );
}

function Bulle({ n, retirer }: { n: Active; retirer: (id: number) => void }) {
  const [envoi, setEnvoi] = useState(false);
  const [pause, setPause] = useState(false);
  const duree = n.duree ?? (n.ton === "erreur" ? 0 : n.annuler ? 10_000 : 6_000);

  useEffect(() => {
    if (!duree || pause) return;
    const t = setTimeout(() => retirer(n.id), duree);
    return () => clearTimeout(t);
  }, [duree, pause, n.id, retirer]);

  async function annuler() {
    setEnvoi(true);
    try {
      await n.annuler?.();
    } finally {
      retirer(n.id);
    }
  }

  return (
    <div
      className="bo-notif"
      data-ton={n.ton ?? "info"}
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
      onFocus={() => setPause(true)}
      onBlur={() => setPause(false)}
    >
      <p>{n.texte}</p>
      {n.annuler && (
        <button type="button" className="bo-bouton bo-bouton-discret" disabled={envoi} onClick={annuler}>
          Annuler
        </button>
      )}
      <button type="button" className="bo-notif-fermer" aria-label="Fermer le message" onClick={() => retirer(n.id)}>
        <IconeGestion nom="fermer" />
      </button>
    </div>
  );
}

/** notifier({ texte: "Plat enregistré.", ton: "succes", annuler: () => remettre() }) */
export function useNotifier(): (n: Notification) => void {
  const n = useContext(Contexte);
  if (!n) throw new Error("useNotifier hors du back-office");
  return n;
}

