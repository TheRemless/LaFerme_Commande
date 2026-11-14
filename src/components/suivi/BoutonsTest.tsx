"use client";

import { useEffect, useState } from "react";

// complement : paiement du complément d'une commande modifiée (vague 3, bo-commandes) à la place de la commande.
export function BoutonsTest({ commande, complement }: { commande?: string; complement?: string }) {
  const [envoi, setEnvoi] = useState(false);
  // Boutons inactifs jusqu'à la prise en main par React : un clic plus tôt ne faisait rien (même cas que FormCode).
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);
  async function issue(i: "paye" | "echec") {
    setEnvoi(true);
    const r = (await (await fetch("/api/paiement-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(complement ? { complement, issue: i } : { commande, issue: i }) })).json()) as {
      redirection?: string;
    };
    if (r.redirection) window.location.assign(r.redirection);
    else setEnvoi(false);
  }
  return (
    <div className="boutons-test">
      <button type="button" className="bouton-principal" disabled={!pret || envoi} onClick={() => issue("paye")}>
        Simuler un paiement réussi
      </button>
      <button type="button" className="bouton-second" disabled={!pret || envoi} onClick={() => issue("echec")}>
        Simuler un refus de la banque
      </button>
    </div>
  );
}
