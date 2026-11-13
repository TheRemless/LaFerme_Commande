"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

// Raccourcis clavier du back-office. useRaccourci("n", ajouter, "Nouveau plat") dans une rubrique ;
// « ? » ouvre la liste de ceux de la page. Ignorés pendant la saisie dans un champ (sauf Échap),
// et quand une fenêtre (confirmation, panneau) est ouverte. Les touches système restent libres.
// Touches : une lettre, « / », « ? », « Escape », ou « mod+k » (Ctrl sur PC, ⌘ sur Mac).

export type Raccourci = { touches: string; description: string };
type Enregistre = Raccourci & { action: () => void };

const Contexte = createContext<{ ajouter: (id: string, r: Enregistre) => void; retirer: (id: string) => void } | null>(null);

function correspond(touches: string, e: KeyboardEvent): boolean {
  const t = touches.toLowerCase();
  if (t.startsWith("mod+")) return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === t.slice(4);
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === t || e.key === touches;
}

function enSaisie(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function FournisseurRaccourcis({ children }: { children: React.ReactNode }) {
  const liste = useRef(new Map<string, Enregistre>());
  const [aide, setAide] = useState(false);
  const [visibles, setVisibles] = useState<Raccourci[]>([]);
  const boite = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const fenetre = document.querySelector("dialog[open]");
      const mod = e.metaKey || e.ctrlKey;
      if (enSaisie(e) && !mod) return;
      if (fenetre) return;
      if (e.key === "?" && !mod) {
        e.preventDefault();
        setVisibles([...liste.current.values()].map(({ touches, description }) => ({ touches, description })));
        setAide(true);
        return;
      }
      for (const r of [...liste.current.values()].reverse()) {
        if (correspond(r.touches, e)) {
          e.preventDefault();
          r.action();
          return;
        }
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);

  useEffect(() => {
    if (aide && !boite.current?.open) boite.current?.showModal();
  }, [aide]);

  const valeur = useMemo(
    () => ({ ajouter: (id: string, r: Enregistre) => liste.current.set(id, r), retirer: (id: string) => liste.current.delete(id) }),
    [],
  );

  return (
    <Contexte.Provider value={valeur}>
      {children}
      {aide && (
        <dialog ref={boite} className="bo-boite" aria-labelledby="bo-raccourcis-titre" onClose={() => setAide(false)}>
          <div className="bo-boite-corps">
            <h2 id="bo-raccourcis-titre">Raccourcis clavier</h2>
            <dl className="bo-raccourcis">
              <div>
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>Cette liste</dd>
              </div>
              {visibles.map((r) => (
                <div key={r.touches}>
                  <dt>
                    <Touches touches={r.touches} />
                  </dt>
                  <dd>{r.description}</dd>
                </div>
              ))}
            </dl>
            <form method="dialog" className="bo-boite-boutons">
              <button className="bo-bouton bo-bouton-principal">Fermer</button>
            </form>
          </div>
        </dialog>
      )}
    </Contexte.Provider>
  );
}

/** « Ctrl » au rendu serveur, « ⌘ » une fois sur un Mac (pas d'écart d'hydratation). */
export function useMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iP(hone|ad)/.test(navigator.platform)), []);
  return mac;
}

export function Touches({ touches }: { touches: string }) {
  const mac = useMac();
  return (
    <>
      {touches.split("+").map((t, i) => (
        <kbd key={i}>{t === "mod" ? (mac ? "⌘" : "Ctrl") : t === "Escape" ? "Échap" : t.toUpperCase()}</kbd>
      ))}
    </>
  );
}

/** Le dernier enregistré gagne (une fiche ouverte passe avant sa liste). */
export function useRaccourci(touches: string, action: () => void, description: string, actif = true) {
  const c = useContext(Contexte);
  const id = useId();
  const derniere = useRef(action);
  derniere.current = action;
  useEffect(() => {
    if (!c || !actif) return;
    c.ajouter(id, { touches, description, action: () => derniere.current() });
    return () => c.retirer(id);
  }, [c, id, touches, description, actif]);
}
