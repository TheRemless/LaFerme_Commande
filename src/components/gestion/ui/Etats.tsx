"use client";

import { useEffect, useState } from "react";

// États d'un écran du back-office. Chaque liste ou fiche en a cinq : chargement, vide, erreur,
// coupure réseau (bandeau de la coque) et droits insuffisants. Aucun ne laisse l'écran blanc.

/** Lignes grises le temps du chargement : la page ne saute pas quand les données arrivent. */
export function Chargement({ lignes = 5, libelle = "Chargement…" }: { lignes?: number; libelle?: string }) {
  return (
    <div className="bo-chargement" role="status" aria-live="polite">
      <span className="sr-only">{libelle}</span>
      {Array.from({ length: lignes }, (_, i) => (
        <span key={i} className="bo-chargement-ligne" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Rien à montrer : dire pourquoi et proposer le geste utile. */
export function EtatVide({ titre, texte, action }: { titre: string; texte?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bo-etat">
      <p className="bo-etat-titre">{titre}</p>
      {texte && <p className="bo-etat-texte">{texte}</p>}
      {action}
    </div>
  );
}

/** Ce qui n'a pas marché, et comment réessayer. */
export function EtatErreur({ texte, reessayer }: { texte: string; reessayer?: () => void }) {
  return (
    <div className="bo-etat bo-etat-erreur" role="alert">
      <p className="bo-etat-titre">{texte}</p>
      {reessayer && (
        <button type="button" className="bo-bouton bo-bouton-second" onClick={reessayer}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Pour une action réservée à un autre rôle (droits fins). */
export function DroitsInsuffisants({ quoi }: { quoi: string }) {
  return <EtatVide titre={`Réservé : ${quoi}.`} texte="Demandez au gérant si vous en avez besoin." />;
}

/** Bandeau de la coque quand le navigateur perd le réseau. Les actions restent possibles mais échoueront. */
export function BandeauHorsLigne() {
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    const maj = () => setHorsLigne(!navigator.onLine);
    maj();
    window.addEventListener("online", maj);
    window.addEventListener("offline", maj);
    return () => {
      window.removeEventListener("online", maj);
      window.removeEventListener("offline", maj);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {horsLigne && <p className="bo-hors-ligne">Pas de connexion. Ce que vous enregistrez maintenant ne partira pas : attendez le retour du réseau.</p>}
    </div>
  );
}
