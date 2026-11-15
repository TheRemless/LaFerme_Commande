"use client";

import { useId, useState } from "react";
import { CAGNOTTE_TOUT } from "@/lib/code-client";
import { prixChf } from "@/lib/prix";
import type { ReponsePanier } from "@/lib/panier-local";

// Cagnotte au paiement (vague 3) : un compte connecté qui paie en ligne la déduit en un clic, en entier ou en
// partie. Le montant déduit vient du serveur (aperçu au panier) ; la base le recalcule au paiement.
export function CagnottePaiement({ cagnotte, onChange }: { cagnotte: NonNullable<ReponsePanier["cagnotte"]>; onChange: (centimes: number) => void }) {
  const ids = useId();
  const [edition, setEdition] = useState<string | null>(null);
  const { solde_centimes: solde, seuil_centimes: seuil, utilisable_centimes: utilisable, utilisee_centimes: utilisee } = cagnotte;

  if (solde < seuil) {
    return (
      <p className="aide cagnotte-paiement">
        Votre cagnotte : {prixChf(solde)}. Elle s&apos;utilise dès {prixChf(seuil)}.
      </p>
    );
  }
  if (utilisable <= 0) return null;

  function appliquer() {
    const chf = Number((edition ?? "").replace(",", "."));
    onChange(Number.isFinite(chf) && chf > 0 ? Math.round(chf * 100) : 0);
    setEdition(null);
  }

  return (
    <div className="champ cagnotte-paiement">
      <label className="option case-compte">
        <input type="checkbox" checked={utilisee > 0} onChange={(e) => onChange(e.target.checked ? CAGNOTTE_TOUT : 0)} />
        <span>
          Utiliser ma cagnotte, {prixChf(solde)} disponibles
        </span>
      </label>
      {utilisee > 0 && edition === null && (
        <p className="aide">
          − {prixChf(utilisee)} sur cette commande.{" "}
          <button type="button" className="lien" onClick={() => setEdition((utilisee / 100).toFixed(2))}>
            Changer le montant
          </button>
        </p>
      )}
      {edition !== null && (
        <div className="cagnotte-montant">
          <label htmlFor={`${ids}-montant`}>Montant à utiliser, en francs</label>
          <input id={`${ids}-montant`} inputMode="decimal" value={edition} onChange={(e) => setEdition(e.target.value)} aria-describedby={`${ids}-max`} />
          <p className="aide" id={`${ids}-max`}>
            Au plus {prixChf(utilisable)} sur cette commande.
          </p>
          <button type="button" className="bouton-second" onClick={appliquer}>
            Appliquer
          </button>
        </div>
      )}
    </div>
  );
}
