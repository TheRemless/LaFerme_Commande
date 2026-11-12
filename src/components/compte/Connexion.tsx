"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormCode } from "@/components/compte/FormCode";

export function Connexion() {
  const router = useRouter();
  // Retour après « Supprimer définitivement » : on le confirme une fois (CM-18).
  const [supprime, setSupprime] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("supprime") === "1") {
      setSupprime(true);
      window.history.replaceState(null, "", "/compte");
    }
  }, []);
  return (
    <div className="connexion">
      <h1>Votre compte</h1>
      {supprime && (
        <p className="panier-alerte" role="status">
          Votre compte est supprimé. Les commandes déjà passées restent dans la comptabilité du restaurant, sans lien avec un compte.
        </p>
      )}
      <div className="connexion-panneau">
        <p>Vos adresses et vos commandes passées, pour recommander la même chose. Pas de mot de passe. On vous envoie un code par e-mail.</p>
        <FormCode onConnecte={() => router.refresh()} />
      </div>
    </div>
  );
}
