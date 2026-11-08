"use client";

import { useRouter } from "next/navigation";
import { FormCode } from "@/components/compte/FormCode";

export function ConnexionPersonnel() {
  const router = useRouter();
  return (
    <div className="connexion connexion-personnel">
      <h1>Tablette du restaurant</h1>
      <div className="connexion-panneau">
        <p>Réservé à l&apos;équipe. Entrez votre e-mail, on vous envoie un code.</p>
        <FormCode api={{ code: "/api/personnel/code", connexion: "/api/personnel/connexion" }} onConnecte={() => router.refresh()} />
      </div>
    </div>
  );
}
