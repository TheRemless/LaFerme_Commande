"use client";

import { useId, useState } from "react";
import { RACCOURCIS_PERIODE, periodeDe, raccourciDe, verifierPeriode, type Periode } from "@/components/gestion/ui/periodes";
import { jourGeneveDe } from "@/lib/heures";

// Sélecteur de période : raccourcis (Aujourd'hui, Hier, 7 derniers jours…) puis deux dates libres.
// Une période fausse (début après fin, trop longue) est dite et n'est pas transmise.

export function SelecteurPeriode({
  valeur,
  onChange,
  maxJours = 366,
  libelle = "Période",
  futur = false,
}: {
  valeur: Periode;
  onChange: (p: Periode) => void;
  maxJours?: number;
  libelle?: string;
  /** Autoriser des dates après aujourd'hui (commandes à l'avance, fermetures prévues). */
  futur?: boolean;
}) {
  const id = useId();
  const aujourdhui = jourGeneveDe(new Date());
  const [brouillon, setBrouillon] = useState<Periode>(valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = raccourciDe(valeur, aujourdhui);

  // La valeur change de l'extérieur (raccourci, autre écran) : le brouillon la suit.
  const [vue, setVue] = useState(valeur);
  if (vue.debut !== valeur.debut || vue.fin !== valeur.fin) {
    setVue(valeur);
    setBrouillon(valeur);
    setErreur(null);
  }

  function proposer(p: Periode) {
    setBrouillon(p);
    const e = verifierPeriode(p, maxJours);
    setErreur(e);
    if (!e) onChange(p);
  }

  return (
    <fieldset className="bo-periode" aria-describedby={erreur ? `${id}-e` : undefined}>
      <legend>{libelle}</legend>
      <div className="bo-periode-raccourcis">
        {RACCOURCIS_PERIODE.map((r) => (
          <button
            key={r.cle}
            type="button"
            className="bo-puce"
            aria-pressed={actif === r.cle}
            onClick={() => proposer(periodeDe(r.cle, aujourdhui))}
          >
            {r.libelle}
          </button>
        ))}
      </div>
      <div className="bo-periode-dates">
        <label htmlFor={`${id}-d`}>Du</label>
        <input id={`${id}-d`} type="date" value={brouillon.debut} max={futur ? undefined : aujourdhui} aria-invalid={erreur ? true : undefined} onChange={(e) => proposer({ ...brouillon, debut: e.target.value })} />
        <label htmlFor={`${id}-f`}>au</label>
        <input id={`${id}-f`} type="date" value={brouillon.fin} max={futur ? undefined : aujourdhui} aria-invalid={erreur ? true : undefined} onChange={(e) => proposer({ ...brouillon, fin: e.target.value })} />
      </div>
      {erreur && (
        <p id={`${id}-e`} className="bo-champ-erreur" role="alert">
          {erreur}
        </p>
      )}
    </fieldset>
  );
}
