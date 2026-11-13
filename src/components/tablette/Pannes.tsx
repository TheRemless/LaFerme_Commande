"use client";

import { useCallback, useEffect, useState } from "react";
import { poster } from "@/lib/requete-client";

// Four en panne, cuisine en panne (vague 3) : tout un poste épuisé jusqu'à ce soir, en deux gestes (le bouton, puis
// la confirmation). Le poste revient seul demain, ou d'un geste. Les ruptures plat par plat restent telles quelles.

type Poste = "pizza" | "cuisine";
const TEXTES: Record<Poste, { panne: string; bouton: string; confirmer: string; remettre: string }> = {
  pizza: { panne: "Four en panne : toutes les pizzas sont épuisées jusqu'à ce soir.", bouton: "Four en panne", confirmer: "Épuiser toutes les pizzas", remettre: "Le four remarche" },
  cuisine: { panne: "Cuisine en panne : tous les plats de la cuisine sont épuisés jusqu'à ce soir.", bouton: "Cuisine en panne", confirmer: "Épuiser toute la cuisine", remettre: "La cuisine remarche" },
};

export function Pannes({ onChange }: { onChange: () => Promise<void> }) {
  const [actives, setActives] = useState<Set<Poste> | null>(null);
  const [confirmer, setConfirmer] = useState<Poste | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const rep = await fetch("/api/tablette/pannes", { cache: "no-store" }).catch(() => null);
    if (!rep?.ok) return;
    const r = (await rep.json()) as { cible: string }[];
    setActives(new Set(r.filter((x) => x.cible.startsWith("poste:")).map((x) => x.cible.slice(6) as Poste)));
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function regler(poste: Poste, panne: boolean) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/pannes", { poste, panne });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    setConfirmer(null);
    await charger();
    await onChange();
    setEnvoi(false);
  }

  if (actives === null) return null;
  return (
    <div className="tab-bloc tab-pannes">
      <h2>Panne</h2>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      {(["pizza", "cuisine"] as Poste[]).map((poste) =>
        actives.has(poste) ? (
          <div key={poste} className="tab-panne-active">
            <p>
              <strong>{TEXTES[poste].panne}</strong>
            </p>
            <button type="button" className="bouton-principal" disabled={envoi} onClick={() => regler(poste, false)}>
              {TEXTES[poste].remettre}
            </button>
          </div>
        ) : confirmer === poste ? (
          <div key={poste} className="boutons-ligne">
            <button type="button" className="bouton-principal" disabled={envoi} onClick={() => regler(poste, true)}>
              {TEXTES[poste].confirmer}
            </button>
            <button type="button" className="bouton-second" disabled={envoi} onClick={() => setConfirmer(null)}>
              Annuler
            </button>
          </div>
        ) : (
          <button key={poste} type="button" className="bouton-second" disabled={envoi} onClick={() => setConfirmer(poste)}>
            {TEXTES[poste].bouton}
          </button>
        ),
      )}
      <p className="aide">Le client voit ces plats épuisés. Ils reviennent seuls demain.</p>
    </div>
  );
}
