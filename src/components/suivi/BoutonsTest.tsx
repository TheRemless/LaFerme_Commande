"use client";

import { useState } from "react";

export function BoutonsTest({ commande }: { commande: string }) {
  const [envoi, setEnvoi] = useState(false);
  async function issue(i: "paye" | "echec") {
    setEnvoi(true);
    const r = (await (await fetch("/api/paiement-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commande, issue: i }) })).json()) as {
      redirection?: string;
    };
    if (r.redirection) window.location.assign(r.redirection);
    else setEnvoi(false);
  }
  return (
    <div className="boutons-test">
      <button type="button" className="bouton-principal" disabled={envoi} onClick={() => issue("paye")}>
        Simuler un paiement réussi
      </button>
      <button type="button" className="bouton-second" disabled={envoi} onClick={() => issue("echec")}>
        Simuler un refus de la banque
      </button>
    </div>
  );
}
