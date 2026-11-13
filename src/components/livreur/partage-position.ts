"use client";

import { useEffect, useRef, useState } from "react";
import { poster } from "@/lib/requete-client";

// Position du livreur en direct (décision de Jérémy du 13.11.2026) : le téléphone la partage seulement pendant le
// trajet vers l'arrêt en cours, une fois toutes les 20 secondes au plus. La base revérifie tout (arrêt en cours,
// parti, réglage ouvert) et n'écrit rien sinon. Fin du trajet, arrêt livré ou page fermée : la position est effacée.

export type EtatPartage =
  | { etat: "inactif" }
  | { etat: "partage"; numero: number | null }
  | { etat: "refuse" }
  | { etat: "indisponible" }
  | { etat: "desactive" };

export const INTERVALLE_POSITION_MS = 20_000;

// Faut-il envoyer cette position ? Oui à la première, à un changement d'arrêt, puis toutes les 20 secondes.
export function envoyerMaintenant(dernier: { arret: string; le: number } | null, arret: string, maintenant: number): boolean {
  return !dernier || dernier.arret !== arret || maintenant - dernier.le >= INTERVALLE_POSITION_MS;
}

const finir = () =>
  fetch("/api/livreur/position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fin: true }),
    keepalive: true,
  }).catch(() => undefined);

export function usePartagePosition(arret: string | null): EtatPartage {
  const [etat, setEtat] = useState<EtatPartage>({ etat: "inactif" });
  const desactive = useRef(false);
  const dernier = useRef<{ arret: string; le: number } | null>(null);

  // Plus en route (dernier arrêt livré, retiré) ou page quittée : la position est effacée tout de suite. Passer à
  // l'arrêt suivant n'efface rien ici : la base remplace la position à l'envoi suivant.
  const partageait = useRef(false);
  useEffect(() => {
    if (arret) partageait.current = true;
    else if (partageait.current) {
      partageait.current = false;
      void finir();
    }
  }, [arret]);
  useEffect(() => () => void (partageait.current && finir()), []);

  useEffect(() => {
    if (!arret || desactive.current) {
      if (!desactive.current) setEtat({ etat: "inactif" });
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setEtat({ etat: "indisponible" });
      return;
    }
    let fini = false;
    const id = navigator.geolocation.watchPosition(
      async (p) => {
        if (fini || !envoyerMaintenant(dernier.current, arret, Date.now())) return;
        dernier.current = { arret, le: Date.now() };
        const r = await poster("/api/livreur/position", { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy });
        if (fini || !r.ok) return;
        if (r.donnees.statut === "desactive") {
          desactive.current = true;
          navigator.geolocation.clearWatch(id);
          setEtat({ etat: "desactive" });
        } else if (r.donnees.statut === "ok") {
          setEtat({ etat: "partage", numero: typeof r.donnees.numero === "number" ? r.donnees.numero : null });
        }
      },
      (e) => {
        if (!fini) setEtat({ etat: e.code === e.PERMISSION_DENIED ? "refuse" : "indisponible" });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    window.addEventListener("pagehide", finir);
    return () => {
      fini = true;
      navigator.geolocation.clearWatch(id);
      window.removeEventListener("pagehide", finir);
      dernier.current = null;
    };
  }, [arret]);

  return etat;
}
