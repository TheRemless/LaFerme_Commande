"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { viderPanier } from "@/lib/panier-local";

// Le suivi se met à jour seul toutes les 20 secondes tant que la commande n'est pas terminée.
// Une commande enregistrée vide le panier de ce navigateur.
export function Actualiser({ actif, commandeEnregistree }: { actif: boolean; commandeEnregistree: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (commandeEnregistree) viderPanier();
  }, [commandeEnregistree]);
  useEffect(() => {
    if (!actif) return;
    const t = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(t);
  }, [actif, router]);
  return null;
}
