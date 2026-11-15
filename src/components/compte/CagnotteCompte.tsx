"use client";

import { useId, useState } from "react";
import { poster } from "@/lib/requete-client";
import { prixChf } from "@/lib/prix";
import type { CagnotteCompte as Donnees, MouvementCagnotte } from "@/lib/cagnotte";

// Cagnotte du compte (vague 3) : le solde en francs, ce qui la fait monter et descendre, la date d'expiration et le
// rappel par e-mail. Textes passés par redaction-fr.

const LIBELLES: Record<MouvementCagnotte["type"], string> = {
  gain: "Gagné",
  utilise: "Utilisé",
  rendu: "Rendu",
  retrait: "Retiré, commande remboursée",
  expire: "Expiré",
  ajustement: "Ajusté par le restaurant",
  parrainage: "Parrainage",
};

function dateCourte(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export function CagnotteCompte({ cagnotte }: { cagnotte: Donnees }) {
  const ids = useId();
  const [rappel, setRappel] = useState(cagnotte.rappel);
  const [erreur, setErreur] = useState<string | null>(null);
  const seuilAtteint = cagnotte.solde_centimes >= cagnotte.seuil_centimes;

  async function changerRappel(v: boolean) {
    setErreur(null);
    setRappel(v);
    const r = await poster("/api/compte/cagnotte", { rappel: v });
    if (!r.ok) {
      setRappel(!v);
      setErreur(typeof r.donnees.erreur === "string" ? r.donnees.erreur : "Le choix n'est pas enregistré. Réessayez.");
    }
  }

  return (
    <section className="espace-bloc cagnotte-compte" aria-labelledby={`${ids}-titre`}>
      <h2 id={`${ids}-titre`}>Votre cagnotte</h2>
      <p className="cagnotte-solde">Vous avez {prixChf(cagnotte.solde_centimes)} dans votre cagnotte.</p>
      <p className="aide">
        Chaque commande livrée ou retirée vous rapporte {cagnotte.taux_pourcent} % du prix des plats.{" "}
        {seuilAtteint
          ? "Au paiement en ligne, vous la déduisez en un clic."
          : `Elle se déduit au paiement en ligne dès ${prixChf(cagnotte.seuil_centimes)}.`}
      </p>
      {cagnotte.expire_le && <p className="aide">À utiliser avant le {dateCourte(cagnotte.expire_le)}. Chaque commande repousse cette date d&apos;un an.</p>}
      <label className="option case-compte">
        <input type="checkbox" checked={rappel} onChange={(e) => void changerRappel(e.target.checked)} />
        <span>Me prévenir par e-mail un mois avant l&apos;expiration</span>
      </label>
      {erreur && (
        <p className="aide aide-erreur" role="alert">
          {erreur}
        </p>
      )}
      {cagnotte.mouvements.length > 0 && (
        <details className="cagnotte-historique">
          <summary>Historique</summary>
          <ul>
            {cagnotte.mouvements.map((m, i) => (
              <li key={`${m.cree_le}-${i}`}>
                <span>
                  {LIBELLES[m.type]}
                  {m.numero ? `, commande ${m.numero}` : ""}
                  <br />
                  <span className="aide">{dateCourte(m.cree_le)}</span>
                </span>
                <span className="cagnotte-montant">
                  {m.montant_centimes > 0 ? "+" : "−"} {prixChf(Math.abs(m.montant_centimes))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
