"use client";

import { useState } from "react";
import { jourGeneveDe } from "@/lib/heures";

// Export comptable (déplacé tel quel depuis BackOffice.tsx, vague 3).
export function GestionExport() {
  const auj = jourGeneveDe(new Date());
  const [debut, setDebut] = useState(`${auj.slice(0, 7)}-01`);
  const [fin, setFin] = useState(auj);
  const [erreur, setErreur] = useState<string | null>(null);

  // Par requête : une période invalide ou une session terminée affiche un message, pas un faux fichier.
  async function telecharger() {
    setErreur(null);
    try {
      const rep = await fetch(`/api/gestion/export?debut=${encodeURIComponent(debut)}&fin=${encodeURIComponent(fin)}`);
      if (!rep.ok) {
        const r = (await rep.json().catch(() => ({}))) as { erreur?: string };
        return setErreur(r.erreur ?? "Export impossible.");
      }
      const url = URL.createObjectURL(await rep.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = rep.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "la-ferme-ventes.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErreur("Pas de connexion. Réessayez.");
    }
  }
  return (
    <section className="ges-bloc">
      <h2>Export comptable</h2>
      <p>
        Ventes encaissées sur la période (payées en ligne ou au comptoir), une ligne par commande, puis le total par taux de TVA. Sans nom ni adresse de
        client. Les commandes remboursées ou refusées n&apos;y sont pas.
      </p>
      <div className="details deux">
        <div className="champ">
          <label htmlFor="export-debut">Du</label>
          <input id="export-debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor="export-fin">Au</label>
          <input id="export-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
      </div>
      <button type="button" className="bouton-principal" onClick={telecharger}>
        Télécharger le fichier CSV
      </button>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
    </section>
  );
}
