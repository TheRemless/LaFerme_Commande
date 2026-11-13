"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { viderPanier } from "@/lib/panier-local";

// Le suivi se met à jour seul toutes les 20 secondes tant que la commande n'est pas terminée (ou qu'un
// remboursement attend Stripe), et tout de suite quand le client revient sur l'onglet ou rallume son téléphone.
// Une commande enregistrée vide le panier de ce navigateur.
export function Actualiser({ actif, commandeEnregistree }: { actif: boolean; commandeEnregistree: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (commandeEnregistree) viderPanier();
  }, [commandeEnregistree]);
  useEffect(() => {
    if (!actif) return;
    const t = window.setInterval(() => router.refresh(), 20_000);
    const retour = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", retour);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", retour);
    };
  }, [actif, router]);
  return null;
}
