"use client";

import { useState } from "react";
import type { CommandeTablette } from "@/lib/tablette";
import { poster } from "@/lib/requete-client";

// « Modifier… » sur la carte d'une commande (vague 3, contrat de bo-commandes) : le client appelle pour corriger son
// téléphone, son nom ou les consignes de livraison. Seuls les champs changés partent ; le client reçoit le nouveau
// récapitulatif et, si les tickets sont déjà sortis, un ticket « MODIFIÉE » sort au poste du sac.

type Details = { etage: string; sonnette: string; code: string; instructions: string };

export function PanneauModifier({ c, fermer }: { c: CommandeTablette; fermer: (message?: string) => Promise<void> }) {
  const [prenom, setPrenom] = useState(c.client_prenom);
  const [nom, setNom] = useState(c.client_nom);
  const [telephone, setTelephone] = useState(c.client_telephone);
  const depart: Details = { etage: "", sonnette: "", code: "", instructions: "", ...(c.details_livraison ?? {}) };
  const [details, setDetails] = useState<Details>(depart);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const corps: Record<string, unknown> = { commande: c.id, de: c.statut };
  if (prenom.trim() !== c.client_prenom) corps.prenom = prenom;
  if (nom.trim() !== c.client_nom) corps.nom = nom;
  if (telephone.trim() !== c.client_telephone) corps.telephone = telephone;
  if (c.mode === "livraison" && (Object.keys(details) as (keyof Details)[]).some((k) => details[k].trim() !== depart[k])) corps.details = details;
  const rien = Object.keys(corps).length === 2;

  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/modifier", corps);
    setEnvoi(false);
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await fermer(String(r.donnees.message ?? "Commande modifiée."));
  }

  const champ = (id: string, libelle: string, valeur: string, changer: (v: string) => void, type = "text") => (
    <div className="champ">
      <label htmlFor={`${c.id}-${id}`}>{libelle}</label>
      <input id={`${c.id}-${id}`} type={type} value={valeur} onChange={(e) => changer(e.target.value)} />
    </div>
  );

  return (
    <div className="tab-actions tab-modifier">
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="tab-modifier-champs">
        {champ("prenom", "Prénom", prenom, setPrenom)}
        {champ("nom", "Nom", nom, setNom)}
        {champ("tel", "Téléphone", telephone, setTelephone, "tel")}
        {c.mode === "livraison" && (
          <>
            {champ("sonnette", "Sonnette", details.sonnette, (v) => setDetails({ ...details, sonnette: v }))}
            {champ("etage", "Étage", details.etage, (v) => setDetails({ ...details, etage: v }))}
            {champ("code", "Code d'entrée", details.code, (v) => setDetails({ ...details, code: v }))}
            {champ("instructions", "Consignes", details.instructions, (v) => setDetails({ ...details, instructions: v }))}
          </>
        )}
      </div>
      <p className="aide">Le client reçoit le nouveau récapitulatif par e-mail. L&apos;adresse se change au back-office.</p>
      <div className="boutons-ligne">
        <button type="button" className="bouton-principal" disabled={envoi || rien} onClick={enregistrer}>
          Enregistrer
        </button>
        <button type="button" className="bouton-second" disabled={envoi} onClick={() => fermer()}>
          Fermer
        </button>
      </div>
    </div>
  );
}
