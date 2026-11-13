"use client";

import { useId, useRef } from "react";

// Onglets internes d'une rubrique (« Fiche · Historique · Remboursements »). Vrais onglets ARIA :
// flèches gauche et droite, Début et Fin pour aller de l'un à l'autre, un seul arrêt de Tab.
// Pour changer de page, utiliser le menu (une adresse par rubrique), pas des onglets.

export type Onglet = { cle: string; titre: string; badge?: number };

export function Onglets({
  onglets,
  actif,
  onChange,
  libelle,
  children,
}: {
  onglets: Onglet[];
  actif: string;
  onChange: (cle: string) => void;
  libelle: string;
  /** Le contenu de l'onglet actif. */
  children: React.ReactNode;
}) {
  const id = useId();
  const boutons = useRef<(HTMLButtonElement | null)[]>([]);

  function aller(i: number) {
    const n = (i + onglets.length) % onglets.length;
    onChange(onglets[n].cle);
    boutons.current[n]?.focus();
  }

  return (
    <div className="bo-onglets">
      <div role="tablist" aria-label={libelle} className="bo-onglets-liste">
        {onglets.map((o, i) => (
          <button
            key={o.cle}
            ref={(el) => {
              boutons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${o.cle}`}
            aria-selected={o.cle === actif}
            aria-controls={`${id}-p`}
            tabIndex={o.cle === actif ? 0 : -1}
            onClick={() => onChange(o.cle)}
            onKeyDown={(e) => {
              const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: onglets.length - 1 }[e.key];
              if (k === undefined) return;
              e.preventDefault();
              aller(k);
            }}
          >
            {o.titre}
            {o.badge ? <span className="bo-onglet-badge">{o.badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-${actif}`} tabIndex={0} className="bo-onglets-panneau">
        {children}
      </div>
    </div>
  );
}
