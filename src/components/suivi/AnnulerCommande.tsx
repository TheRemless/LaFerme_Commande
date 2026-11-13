"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { poster } from "@/lib/requete-client";

// Annulation par le client avant l'acceptation (arbitrage C1, désactivée par défaut : réglage
// annulation_client_active). La route revérifie tout : réglage, statut, jeton (bo-commandes, #70).
export function AnnulerCommande({ jeton, numero, payeeEnLigne }: { jeton: string; numero: number; payeeEnLigne: boolean }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "confirmer" | "envoi" | { message: string; ok: boolean }>("repos");

  async function annuler() {
    setEtat("envoi");
    const r = await poster("/api/suivi/annuler", { jeton });
    const message = String((r.ok ? r.donnees.message : r.donnees.erreur) ?? "Impossible pour le moment. Appelez-nous au 022 792 16 89.");
    setEtat({ message, ok: r.ok });
    if (r.ok) router.refresh();
  }

  if (etat === "repos") {
    return (
      <button type="button" className="bouton-second suivi-annuler" onClick={() => setEtat("confirmer")}>
        Annuler ma commande
      </button>
    );
  }
  if (etat === "confirmer" || etat === "envoi") {
    return (
      <div className="suivi-annuler-confirmer" role="group" aria-label="Confirmer l'annulation">
        <p>
          Annuler la commande n° {numero} ? Le restaurant ne la préparera pas.
          {payeeEnLigne ? " Le montant vous est remboursé." : ""}
        </p>
        <div className="boutons-ligne">
          <button type="button" className="bouton-principal" onClick={annuler} disabled={etat === "envoi"}>
            {etat === "envoi" ? "Un instant…" : "Oui, annuler"}
          </button>
          <button type="button" className="lien" onClick={() => setEtat("repos")} disabled={etat === "envoi"}>
            Garder ma commande
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className={etat.ok ? "suivi-info" : "suivi-retard"} role={etat.ok ? "status" : "alert"}>
      {etat.message}
    </p>
  );
}
