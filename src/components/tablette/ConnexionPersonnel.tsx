"use client";

import { useRouter } from "next/navigation";
import { FormCode } from "@/components/compte/FormCode";

export function ConnexionPersonnel({ titre = "Tablette du restaurant" }: { titre?: string }) {
  const router = useRouter();
  return (
    <div className="connexion connexion-personnel">
      <h1>{titre}</h1>
      <div className="connexion-panneau">
        <p>Réservé à l&apos;équipe. Entrez votre e-mail, on vous envoie un code.</p>
        <FormCode api={{ code: "/api/personnel/code", connexion: "/api/personnel/connexion" }} onConnecte={() => router.refresh()} />
      </div>
    </div>
  );
}
