"use client";

import { useId, useState } from "react";
import { poster } from "@/lib/requete-client";

// Réclamation depuis le suivi (route de bo-commandes, #87) : le client dit ce qui ne va pas, le restaurant reçoit
// une alerte et le dossier dans le back-office. La route revérifie tout (statut, 14 jours, trois au plus).
const TYPES = [
  ["retard", "Elle est arrivée en retard"],
  ["manquant", "Il manquait quelque chose"],
  ["froid", "C'était froid"],
  ["erreur", "Ce n'est pas ce que j'ai commandé"],
  ["qualite", "Un plat n'était pas bon"],
  ["livraison", "Un souci avec la livraison"],
  ["autre", "Autre chose"],
] as const;

export function Reclamation({ jeton, livraison }: { jeton: string; livraison: boolean }) {
  const ids = useId();
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [etat, setEtat] = useState<"repos" | "envoi" | { ok: boolean; message: string }>("repos");
  const types = TYPES.filter(([cle]) => livraison || (cle !== "livraison" && cle !== "retard"));

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEtat("envoi");
    const r = await poster("/api/suivi/reclamation", { jeton, type, description });
    setEtat({ ok: r.ok, message: String((r.ok ? r.donnees.message : r.donnees.erreur) ?? "Pas envoyé. Appelez-nous au 022 792 16 89.") });
  }

  if (typeof etat === "object" && etat.ok) {
    return (
      <section className="suivi-reclamation" aria-labelledby={`${ids}-titre`}>
        <h2 id={`${ids}-titre`}>Un problème avec cette commande ?</h2>
        <p role="status">{etat.message}</p>
      </section>
    );
  }
  return (
    <section className="suivi-reclamation" aria-labelledby={`${ids}-titre`}>
      <h2 id={`${ids}-titre`}>Un problème avec cette commande ?</h2>
      {!ouvert ? (
        <button type="button" className="bouton-second" onClick={() => setOuvert(true)}>
          Signaler un problème
        </button>
      ) : (
        <form onSubmit={envoyer}>
          <fieldset className="choix-reclamation">
            <legend>Qu&apos;est-ce qui ne va pas ?</legend>
            {types.map(([cle, libelle]) => (
              <label key={cle} className="option">
                <input type="radio" name={`${ids}-type`} value={cle} checked={type === cle} onChange={() => setType(cle)} required />
                <span>{libelle}</span>
              </label>
            ))}
          </fieldset>
          <div className="champ">
            <label htmlFor={`${ids}-description`}>Dites-nous ce qui s&apos;est passé</label>
            <textarea
              id={`${ids}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minLength={3}
              maxLength={500}
              rows={4}
              required
              aria-describedby={`${ids}-compte`}
            />
            <p className="aide" id={`${ids}-compte`}>
              {description.length} / 500
            </p>
          </div>
          <button type="submit" className="bouton-principal" disabled={etat === "envoi"}>
            {etat === "envoi" ? "Un instant…" : "Envoyer au restaurant"}
          </button>
          {typeof etat === "object" && !etat.ok && (
            <p className="panier-alerte" role="alert">
              {etat.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
