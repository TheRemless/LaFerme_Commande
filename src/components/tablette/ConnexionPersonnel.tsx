"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormCode } from "@/components/compte/FormCode";
import { poster } from "@/lib/requete-client";

// codeLivreur (vague 3, D13 point 3, construit désactivé) : sur /livreur, « J'ai un code du restaurant » quand le
// réglage connexion_livreur_par_code est ouvert. Le code est affiché sur la tablette par le gérant ou un responsable.
export function ConnexionPersonnel({ titre = "Tablette du restaurant", codeLivreur = false }: { titre?: string; codeLivreur?: boolean }) {
  const router = useRouter();
  return (
    <div className="connexion connexion-personnel">
      <h1>{titre}</h1>
      {codeLivreur && <CodeDuRestaurant onConnecte={() => router.refresh()} />}
      <div className="connexion-panneau">
        <p>Réservé à l&apos;équipe. Entrez votre e-mail, on vous envoie un code.</p>
        <FormCode api={{ code: "/api/personnel/code", connexion: "/api/personnel/connexion" }} chiffres={8} onConnecte={() => router.refresh()} />
      </div>
    </div>
  );
}

function CodeDuRestaurant({ onConnecte }: { onConnecte: () => void }) {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/personnel/code-livreur", { code: code.replace(/\D/g, "") });
    setEnvoi(false);
    if (r.ok) onConnecte();
    else setErreur(String(r.donnees.erreur ?? "Code refusé. Réessayez."));
  }
  return (
    <form className="connexion-panneau" onSubmit={envoyer}>
      <p>
        <strong>J&apos;ai un code du restaurant.</strong> Le gérant l&apos;affiche sur la tablette.
      </p>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="champ">
        <label htmlFor="code-restaurant">Code à 8 chiffres de la tablette</label>
        <input id="code-restaurant" inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button type="submit" className="bouton-principal" disabled={envoi || code.replace(/\D/g, "").length !== 8}>
        Ouvrir mes livraisons
      </button>
    </form>
  );
}
