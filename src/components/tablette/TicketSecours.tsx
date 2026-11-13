"use client";

import { useEffect, useRef } from "react";
import type { LigneTicket } from "@/lib/impression/ticket";
import "./ticket-secours.css";

// Ticket affiché en grand sur la tablette quand l'imprimante ne répond pas (ou qu'il n'y en a pas).
export function TicketSecours({ tickets, fermer }: { tickets: { station: string; contenu: LigneTicket[] }[]; fermer: () => void }) {
  const bouton = useRef<HTMLButtonElement>(null);
  // La tablette se met à jour toutes les 5 s : la fonction change, le focus et l'écouteur restent.
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  useEffect(() => {
    bouton.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && fermerRef.current();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, []);
  return (
    <div className="ticket-fond" role="dialog" aria-modal="true" aria-label="Ticket de cuisine">
      <div className="ticket-boite">
        <button ref={bouton} type="button" className="bouton-principal" onClick={fermer}>
          Fermer le ticket
        </button>
        {tickets.map((t, i) => (
          <div key={i} className="ticket">
            {t.contenu.map((l, j) =>
              l.t === "filet" ? (
                <hr key={j} />
              ) : l.t === "deux" ? (
                <p key={j} className={`ticket-l t${l.taille ?? 1} ${l.gras ? "g" : ""} ticket-deux`}>
                  <span>{l.gauche}</span>
                  <span>{l.droite}</span>
                </p>
              ) : (
                <p key={j} className={`ticket-l t${l.taille ?? 1} ${l.gras ? "g" : ""} ${l.retrait ? "r" : ""} ${l.inverse ? "i" : ""}`}>
                  {l.texte}
                </p>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
