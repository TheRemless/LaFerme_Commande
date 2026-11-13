"use client";

import { useState } from "react";
import { heureDe as heure } from "@/lib/heures";
import { poster } from "@/lib/requete-client";

// « Code de connexion » d'un livreur (vague 3, D13 point 3, construit désactivé) : le gérant ou un responsable le
// touche, la tablette montre 8 chiffres en grand, valables 10 minutes et une seule fois ; le livreur les tape sur
// /livreur. Zéro e-mail.
export function CodeLivreur({ livreur, nom }: { livreur: string; nom: string }) {
  const [code, setCode] = useState<{ code: string; expire_le: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function creer() {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/code-livreur", { livreur });
    setEnvoi(false);
    if (r.ok) setCode(r.donnees as { code: string; expire_le: string });
    else setErreur(String(r.donnees.erreur ?? "Pas de code. Réessayez."));
  }

  if (code) {
    return (
      <div className="tab-code-livreur" role="status">
        <p>
          Code pour <strong>{nom}</strong>, à taper sur son téléphone (page Livraisons) :
        </p>
        <p className="tab-code-chiffres" aria-label={`Code ${code.code.split("").join(" ")}`}>
          {code.code.slice(0, 4)} {code.code.slice(4)}
        </p>
        <p className="aide">Valable jusqu&apos;à {heure(code.expire_le)}, une seule fois. Il ouvre sa session pour la soirée.</p>
        <button type="button" className="bouton-second" onClick={() => setCode(null)}>
          Masquer
        </button>
      </div>
    );
  }
  return (
    <>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <button type="button" className="bouton-second" disabled={envoi} onClick={creer}>
        Code de connexion
      </button>
    </>
  );
}
