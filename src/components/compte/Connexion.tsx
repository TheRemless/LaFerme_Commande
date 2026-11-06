"use client";

import { useRouter } from "next/navigation";
import { FormCode } from "@/components/compte/FormCode";

export function Connexion() {
  const router = useRouter();
  return (
    <div className="connexion">
      <h1>Votre compte</h1>
      <div className="connexion-panneau">
        <p>Vos adresses et vos commandes passées, pour recommander la même chose. Pas de mot de passe. On vous envoie un code par e-mail.</p>
        <FormCode onConnecte={() => router.refresh()} />
      </div>
    </div>
  );
}
