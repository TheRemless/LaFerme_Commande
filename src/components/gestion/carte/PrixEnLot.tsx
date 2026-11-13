"use client";

import { useState } from "react";
import { montant } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Changer les prix de plusieurs plats : règle, aperçu calculé par la base (avant, après), puis application
// tout ou rien. Rien n'est écrit tant qu'on n'a pas appuyé sur « Appliquer ».

type Regle = "pourcentage" | "montant";
type LigneApercu = { slug: string; nom: string; avant: number; apres: number };

export function PrixEnLot({ slugs, fini }: { slugs: string[]; fini: (n: number) => Promise<void> }) {
  const [regle, setRegle] = useState<Regle>("pourcentage");
  const [sens, setSens] = useState<1 | -1>(1);
  const [valeur, setValeur] = useState("");
  const [arrondi, setArrondi] = useState(10);
  const [valide, setValide] = useState(false);
  const [apercu, setApercu] = useState<LigneApercu[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // « 5 » → 500 (centièmes de pour cent) ou « 1.50 » → 150 centimes, avec le signe choisi.
  function lot() {
    const n = Number(valeur.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    return { slugs, regle, valeur: Math.round(n * 100) * sens, arrondi, prix_valide: valide };
  }

  async function demander(appliquer: boolean) {
    const l = lot();
    if (!l) return setErreur(regle === "pourcentage" ? "Indiquez un pourcentage plus grand que zéro." : "Indiquez un montant en francs plus grand que zéro.");
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/gestion/carte", { type: "prix_en_lot", lot: l, appliquer });
    setEnvoi(false);
    if (!r.ok) {
      setApercu(null);
      return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    }
    const lignes = r.donnees.lignes as LigneApercu[];
    if (appliquer) return fini(lignes.filter((x) => x.apres !== x.avant).length);
    setApercu(lignes);
  }

  const changer = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setApercu(null);
  };

  return (
    <div className="bo-formulaire">
      <fieldset className="bo-choix">
        <legend>Changement</legend>
        <label className="bo-case">
          <input type="radio" name="lot-regle" checked={regle === "pourcentage"} onChange={() => changer(setRegle)("pourcentage")} />
          <span>En pour cent</span>
        </label>
        <label className="bo-case">
          <input type="radio" name="lot-regle" checked={regle === "montant"} onChange={() => changer(setRegle)("montant")} />
          <span>En francs</span>
        </label>
      </fieldset>
      <fieldset className="bo-choix">
        <legend>Sens</legend>
        <label className="bo-case">
          <input type="radio" name="lot-sens" checked={sens === 1} onChange={() => changer(setSens)(1)} />
          <span>Hausse</span>
        </label>
        <label className="bo-case">
          <input type="radio" name="lot-sens" checked={sens === -1} onChange={() => changer(setSens)(-1)} />
          <span>Baisse</span>
        </label>
      </fieldset>
      <div className="bo-champ">
        <label htmlFor="lot-valeur">{regle === "pourcentage" ? "Pourcentage" : "Montant (CHF)"}</label>
        <input id="lot-valeur" inputMode="decimal" value={valeur} onChange={(e) => changer(setValeur)(e.target.value)} />
      </div>
      <div className="bo-champ">
        <label htmlFor="lot-arrondi">Arrondi</label>
        <select id="lot-arrondi" value={arrondi} onChange={(e) => changer(setArrondi)(Number(e.target.value))}>
          <option value={5}>5 centimes</option>
          <option value={10}>10 centimes</option>
          <option value={50}>50 centimes</option>
          <option value={100}>Au franc</option>
        </select>
      </div>
      <label className="bo-case">
        <input type="checkbox" checked={valide} onChange={(e) => changer(setValide)(e.target.checked)} />
        <span>Prix validés (sinon, ils repartent à valider)</span>
      </label>
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <button type="button" className="bo-bouton bo-bouton-second" disabled={envoi} onClick={() => demander(false)}>
        Voir l&apos;aperçu
      </button>
      {apercu && (
        <>
          <table className="bo-apercu">
            <caption>Aperçu : rien n&apos;est encore enregistré.</caption>
            <thead>
              <tr>
                <th scope="col">Plat</th>
                <th scope="col" className="nombre">Avant</th>
                <th scope="col" className="nombre">Après</th>
              </tr>
            </thead>
            <tbody>
              {apercu.map((l) => (
                <tr key={l.slug}>
                  <th scope="row">{l.nom}</th>
                  <td className="nombre">{montant(l.avant)}</td>
                  <td className="nombre">{l.apres === l.avant ? "inchangé" : montant(l.apres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="bo-bouton bo-bouton-principal" disabled={envoi} onClick={() => demander(true)}>
            {envoi ? "Enregistrement…" : `Appliquer à ${apercu.filter((l) => l.apres !== l.avant).length} plat${apercu.filter((l) => l.apres !== l.avant).length > 1 ? "s" : ""}`}
          </button>
        </>
      )}
    </div>
  );
}
