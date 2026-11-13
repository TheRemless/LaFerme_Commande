"use client";

import { useEffect, useRef } from "react";
import { usePeutPartir } from "@/components/gestion/ui/Garde";
import { IconeGestion } from "@/components/gestion/ui/icones";

// Panneau de fiche, ouvert à droite par-dessus une liste (une commande, un plat, un client).
// Fenêtre modale (<dialog>) : focus dedans, Échap ou le fond le ferment, le focus revient à la ligne
// d'où l'on vient. Avec des changements non enregistrés, il demande avant de se fermer.
// Sur téléphone, il prend tout l'écran.

export function PanneauLateral({
  titre,
  sousTitre,
  onFermer,
  pied,
  large,
  children,
}: {
  titre: string;
  sousTitre?: React.ReactNode;
  onFermer: () => void;
  /** Boutons d'action collés en bas (Enregistrer, Rembourser…). */
  pied?: React.ReactNode;
  /** 720 px au lieu de 520. */
  large?: boolean;
  children: React.ReactNode;
}) {
  const boite = useRef<HTMLDialogElement>(null);
  const retour = useRef<Element | null>(null);
  const peutPartir = usePeutPartir();

  useEffect(() => {
    retour.current = document.activeElement;
    const d = boite.current!;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>(".bo-panneau-fermer")?.focus();
    return () => {
      if (retour.current instanceof HTMLElement && retour.current.isConnected) retour.current.focus();
    };
  }, []);

  async function fermer() {
    if (await peutPartir()) onFermer();
  }

  return (
    <dialog
      ref={boite}
      className="bo-panneau"
      data-large={large || undefined}
      aria-labelledby="bo-panneau-titre"
      onCancel={(e) => {
        e.preventDefault();
        fermer();
      }}
      onClick={(e) => {
        if (e.target === boite.current) fermer();
      }}
    >
      <div className="bo-panneau-cadre">
        <header className="bo-panneau-tete">
          <div>
            <h2 id="bo-panneau-titre">{titre}</h2>
            {sousTitre && <p className="bo-panneau-sous">{sousTitre}</p>}
          </div>
          <button type="button" className="bo-panneau-fermer" aria-label="Fermer la fiche" onClick={fermer}>
            <IconeGestion nom="fermer" />
          </button>
        </header>
        <div className="bo-panneau-corps">{children}</div>
        {pied && <footer className="bo-panneau-pied">{pied}</footer>}
      </div>
    </dialog>
  );
}
