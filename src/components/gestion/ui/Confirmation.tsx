"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Boîte de confirmation : une vraie fenêtre (<dialog> modal, focus gardé dedans, Échap = non).
// const confirmer = useConfirmer();
// if (await confirmer({ titre: "Retirer Marco ?", texte: "Ses sessions sont coupées.", oui: "Retirer Marco", danger: true })) …
// Le bouton « oui » dit l'action (« Retirer Marco »), jamais « OK ». Le focus part sur « non » quand l'action est grave.

export type Demande = {
  titre: string;
  texte?: React.ReactNode;
  oui: string;
  non?: string;
  /** Action qui ne se défait pas : le focus part sur « non » et le bouton « oui » est marqué. */
  danger?: boolean;
};
type EnCours = Demande & { repondre: (ok: boolean) => void };

const Contexte = createContext<((d: Demande) => Promise<boolean>) | null>(null);

export function FournisseurConfirmation({ children }: { children: React.ReactNode }) {
  const [demande, setDemande] = useState<EnCours | null>(null);
  const confirmer = useCallback(
    (d: Demande) =>
      new Promise<boolean>((resoudre) => {
        // Une seule boîte à la fois : une demande encore ouverte vaut « non ».
        setDemande((avant) => {
          avant?.repondre(false);
          return { ...d, repondre: resoudre };
        });
      }),
    [],
  );
  return (
    <Contexte.Provider value={confirmer}>
      {children}
      {demande && (
        <BoiteConfirmation
          {...demande}
          onReponse={(ok) => {
            demande.repondre(ok);
            setDemande(null);
          }}
        />
      )}
    </Contexte.Provider>
  );
}

export function BoiteConfirmation({ titre, texte, oui, non = "Annuler", danger, onReponse }: Demande & { onReponse: (ok: boolean) => void }) {
  const boite = useRef<HTMLDialogElement>(null);
  const retour = useRef<Element | null>(null);
  const boutonNon = useRef<HTMLButtonElement>(null);
  const boutonOui = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retour.current = document.activeElement;
    const d = boite.current!;
    if (!d.open) d.showModal();
    (danger ? boutonNon : boutonOui).current?.focus();
    return () => {
      if (retour.current instanceof HTMLElement) retour.current.focus();
    };
  }, [danger]);

  return (
    <dialog
      ref={boite}
      className="bo-boite"
      aria-labelledby="bo-boite-titre"
      onCancel={(e) => {
        e.preventDefault();
        onReponse(false);
      }}
      onClick={(e) => {
        // Un clic sur le fond (hors de la boîte) vaut « non ».
        if (e.target === boite.current) onReponse(false);
      }}
    >
      <div className="bo-boite-corps">
        <h2 id="bo-boite-titre">{titre}</h2>
        {texte && <div className="bo-boite-texte">{texte}</div>}
        <div className="bo-boite-boutons">
          <button ref={boutonNon} type="button" className="bo-bouton bo-bouton-second" onClick={() => onReponse(false)}>
            {non}
          </button>
          <button ref={boutonOui} type="button" className="bo-bouton bo-bouton-principal" data-danger={danger || undefined} onClick={() => onReponse(true)}>
            {oui}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function useConfirmer(): (d: Demande) => Promise<boolean> {
  const c = useContext(Contexte);
  if (!c) throw new Error("useConfirmer hors du back-office");
  return c;
}
