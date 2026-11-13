"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { adresseTexte, type Adresse, type Details } from "@/lib/adresse";
import { poster } from "@/lib/requete-client";

type Champ = keyof Details;
const VIDE: Details = { etage: "", sonnette: "", code: "", instructions: "" };

// Une adresse du compte : ses consignes de livraison, à corriger ici (mêmes libellés et limites qu'à l'accueil).
export function AdresseEnregistree({ a, occupe, retirer }: { a: { id: string; adresse: Adresse; details: Partial<Details> }; occupe: boolean; retirer: () => void }) {
  const router = useRouter();
  const ids = useId();
  const [ouvert, setOuvert] = useState(false);
  const [details, setDetails] = useState<Details>({ ...VIDE, ...a.details });
  const [etat, setEtat] = useState<"repos" | "envoi" | string>("repos");
  const texte = adresseTexte(a.adresse);
  const consignes = [a.details.etage && `étage ${a.details.etage}`, a.details.sonnette && `sonnette ${a.details.sonnette}`, a.details.code && `code ${a.details.code}`]
    .filter(Boolean)
    .join(", ");

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setEtat("envoi");
    const r = await poster("/api/compte/adresses", { modifier: a.id, details });
    if (r.statut === 401) return router.refresh();
    if (!r.ok) return setEtat(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    setEtat("repos");
    setOuvert(false);
    router.refresh();
  }

  const champ = (cle: Champ, max: number) => ({
    id: `${ids}-${cle}`,
    value: details[cle],
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDetails({ ...details, [cle]: e.target.value }),
  });

  return (
    <li>
      <span>
        <strong>{texte}</strong>
        {consignes && <small>{consignes}</small>}
        {a.details.instructions && <small>{a.details.instructions}</small>}
      </span>
      {!ouvert ? (
        <span className="adresse-actions">
          <button type="button" className="lien" disabled={occupe} onClick={() => setOuvert(true)} aria-label={`Modifier les consignes, ${texte}`}>
            Modifier
          </button>
          <button type="button" className="lien" disabled={occupe} onClick={retirer} aria-label={`Retirer ${texte}`}>
            Retirer
          </button>
        </span>
      ) : (
        <form className="form-adresse" onSubmit={enregistrer} aria-label={`Consignes, ${texte}`}>
          <div className="champ">
            <label htmlFor={`${ids}-etage`}>
              Étage <span className="facultatif">facultatif</span>
            </label>
            <input {...champ("etage", 30)} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-sonnette`}>Nom sur la sonnette</label>
            <input {...champ("sonnette", 60)} required />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-code`}>
              Code d&apos;entrée <span className="facultatif">facultatif</span>
            </label>
            <input {...champ("code", 30)} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-instructions`}>
              Pour le livreur <span className="facultatif">facultatif</span>
            </label>
            <input {...champ("instructions", 140)} />
          </div>
          <div className="boutons-ligne">
            <button type="submit" className="bouton-second" disabled={etat === "envoi"}>
              {etat === "envoi" ? "Un instant…" : "Enregistrer"}
            </button>
            <button type="button" className="lien" onClick={() => setOuvert(false)}>
              Annuler
            </button>
          </div>
          {etat !== "repos" && etat !== "envoi" && (
            <p className="panier-alerte" role="alert">
              {etat}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
