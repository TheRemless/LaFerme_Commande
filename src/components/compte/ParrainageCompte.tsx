"use client";

import { useId, useState } from "react";
import { prixChf } from "@/lib/prix";
import type { ParrainageCompte as Donnees } from "@/lib/parrainage";

// Parrainage (vague 3) : le lien personnel à envoyer, et où en sont les proches parrainés. Jamais leur nom.
// Textes passés par redaction-fr.
export function ParrainageCompte({ parrainage, lien }: { parrainage: Donnees; lien: string }) {
  const ids = useId();
  const [copie, setCopie] = useState(false);
  const montant = prixChf(parrainage.montant_centimes);

  async function copier() {
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(true);
    } catch {
      setCopie(false);
    }
  }

  return (
    <div className="parrainage-compte">
      <h3 id={`${ids}-titre`}>Parrainez un proche</h3>
      {parrainage.parraine === "en_attente" && (
        <p className="aide">Un proche vous a parrainé. {montant} vous attendent après votre première commande livrée ou retirée.</p>
      )}
      <p className="aide">
        Envoyez ce lien à un proche qui n&apos;a jamais commandé chez nous. Après sa première commande livrée ou retirée, vous recevez chacun {montant} dans
        votre cagnotte.
      </p>
      <label htmlFor={`${ids}-lien`}>Votre lien</label>
      <input id={`${ids}-lien`} readOnly value={lien} onFocus={(e) => e.target.select()} />
      <button type="button" className="bouton-second" onClick={() => void copier()}>
        {copie ? "Lien copié" : "Copier le lien"}
      </button>
      {(parrainage.credites > 0 || parrainage.en_attente > 0) && (
        <p className="aide" role="status">
          {parrainage.credites > 0 && `${parrainage.credites} proche${parrainage.credites > 1 ? "s" : ""} parrainé${parrainage.credites > 1 ? "s" : ""}. `}
          {parrainage.en_attente > 0 && `${parrainage.en_attente} en attente de leur première commande.`}
        </p>
      )}
    </div>
  );
}
