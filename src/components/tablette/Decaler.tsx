"use client";

import { useState } from "react";
import { poster } from "@/lib/requete-client";

// « +N min sur les commandes en cours » (vague 3, P0 de produit-gestion ; serveur de bo-operations) : deux gestes.
// 1. « Décaler les commandes en cours… » montre ce que le geste toucherait (commandes, clients prévenus).
// 2. « +10 min » décale et prévient chaque client par e-mail. La clé du geste est tirée à ce moment : un double appui
// ne décale pas deux fois. Avec un poste (vue par poste) : seulement les commandes que ce poste n'a pas sorties.

const MINUTES = [5, 10, 15, 20];

export function Decaler({ station = null, onChange }: { station?: "pizza" | "cuisine" | null; onChange?: () => Promise<void> | void }) {
  const [apercu, setApercu] = useState<{ commandes: number; clients: number } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ouvrir() {
    setErreur(null);
    setMessage(null);
    const rep = await fetch(`/api/tablette/decaler${station ? `?station=${station}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!rep?.ok) return setErreur("Pas encore disponible : réglez le retard ce soir à la place.");
    setApercu(await rep.json());
  }

  async function decaler(minutes: number) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/decaler", { minutes, station, cle: crypto.randomUUID() });
    if (r.ok) {
      const d = r.donnees as { commandes: number; prevenus: number; deja: boolean };
      setMessage(
        d.commandes === 0
          ? "Aucune commande à décaler."
          : `${d.commandes} ${d.commandes > 1 ? "commandes décalées" : "commande décalée"} de ${minutes} min, ${d.prevenus} ${d.prevenus > 1 ? "clients prévenus" : "client prévenu"} par e-mail.`,
      );
      setApercu(null);
      await onChange?.();
    } else {
      setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    }
    setEnvoi(false);
  }

  return (
    <div className="tab-decaler">
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {apercu === null ? (
        <button type="button" className="bouton-second" disabled={envoi} onClick={ouvrir}>
          {station ? `Décaler les commandes ${station === "pizza" ? "pizza" : "cuisine"}…` : "Décaler les commandes en cours…"}
        </button>
      ) : apercu.commandes === 0 ? (
        <div className="tab-decaler-choix">
          <p>Aucune commande en cours à décaler.</p>
          <button type="button" className="bouton-second" onClick={() => setApercu(null)}>
            Fermer
          </button>
        </div>
      ) : (
        <div className="tab-decaler-choix">
          <p>
            <strong>
              {apercu.commandes} {apercu.commandes > 1 ? "commandes" : "commande"}
            </strong>
            , {apercu.clients} {apercu.clients > 1 ? "clients prévenus" : "client prévenu"} par e-mail. Décaler de :
          </p>
          <div className="boutons-ligne">
            {MINUTES.map((m) => (
              <button key={m} type="button" className="bouton-principal" disabled={envoi} onClick={() => decaler(m)}>
                +{m} min
              </button>
            ))}
            <button type="button" className="bouton-second" disabled={envoi} onClick={() => setApercu(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
