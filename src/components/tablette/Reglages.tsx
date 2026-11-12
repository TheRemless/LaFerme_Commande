"use client";

import { useEffect, useMemo, useState } from "react";
import { heureDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";

type Props = {
  reglages: { pause: { active: boolean; jusqua: string | null; livraisonFermee: boolean } | null; preparation_minutes: number; retard_minutes?: number };
  onChange: () => Promise<void>;
};

type Plat = { slug: string; nom: string; categorie: string; rupture: boolean };
// Supplément (audit du gérant, G07) : épuisé pour la journée comme un plat.
type Option = { groupe: string; groupe_nom: string; nom: string; rupture: boolean };


// Pause des commandes en ligne, livraison, délai de préparation et ruptures du jour.
export function Reglages({ reglages, onChange }: Props) {
  const [plats, setPlats] = useState<Plat[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const [options, setOptions] = useState<Option[] | null>(null);
  async function chargerPlats() {
    const [rep, repOptions] = await Promise.all([
      fetch("/api/tablette/plats", { cache: "no-store" }).catch(() => null),
      fetch("/api/tablette/options", { cache: "no-store" }).catch(() => null),
    ]);
    if (rep?.ok) setPlats(await rep.json());
    if (repOptions?.ok) setOptions(await repOptions.json());
  }
  useEffect(() => {
    chargerPlats();
  }, []);

  async function regler(corps: Record<string, unknown>) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/reglages", corps);
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await onChange();
    setEnvoi(false);
  }

  async function ruptureOption(o: Option) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/options", { groupe: o.groupe, nom: o.nom, rupture: !o.rupture });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await chargerPlats();
    setEnvoi(false);
  }

  async function rupture(p: Plat) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/plats", { slug: p.slug, rupture: !p.rupture });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await chargerPlats();
    setEnvoi(false);
  }

  const p = reglages.pause;
  const retard = reglages.retard_minutes ?? 0;
  const enPause = p?.active && (!p.jusqua || new Date(p.jusqua).getTime() > Date.now());
  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (plats ?? []).filter((x) => !q || x.nom.toLowerCase().includes(q));
  }, [plats, recherche]);
  const enRupture = (plats ?? []).filter((x) => x.rupture);
  const optionsEpuisees = (options ?? []).filter((x) => x.rupture);
  const optionsFiltrees = (options ?? []).filter((x) => !recherche.trim() || x.nom.toLowerCase().includes(recherche.trim().toLowerCase()));

  return (
    <section className="tab-reglages" aria-label="Réglages du service">
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="tab-bloc">
        <h2>Commandes en ligne</h2>
        <p>{enPause ? (p?.jusqua ? `En pause jusqu'à ${heureDe(p.jusqua)}. Elles reprennent seules.` : "En pause jusqu'à ce que vous repreniez.") : "Ouvertes."}</p>
        <div className="boutons-ligne">
          {enPause ? (
            <button type="button" className="bouton-principal" disabled={envoi} onClick={() => regler({ pause: "reprendre" })}>
              Reprendre les commandes
            </button>
          ) : (
            <>
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => regler({ pause: 30 })}>
                Pause 30 min
              </button>
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => regler({ pause: 60 })}>
                Pause 1 h
              </button>
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => regler({ pause: "sans-fin" })}>
                Pause jusqu&apos;à reprise
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tab-bloc">
        <h2>Livraison</h2>
        <p>{p?.livraisonFermee ? "Fermée. Les clients peuvent encore commander à emporter." : "Ouverte."}</p>
        <button type="button" className="bouton-second" disabled={envoi} onClick={() => regler({ livraisonFermee: !p?.livraisonFermee })}>
          {p?.livraisonFermee ? "Rouvrir la livraison" : "Fermer la livraison"}
        </button>
      </div>

      <div className="tab-bloc">
        <h2>Retard ce soir</h2>
        <div className="tab-delai">
          <button
            type="button"
            className="bouton-second"
            disabled={envoi || retard <= 0}
            onClick={() => regler({ retard: Math.max(0, retard - 5) })}
            aria-label="5 minutes de retard en moins"
          >
            −5
          </button>
          <p aria-live="polite">{retard ? `+${retard} min` : "Aucun"}</p>
          <button
            type="button"
            className="bouton-second"
            disabled={envoi || retard >= 90}
            onClick={() => regler({ retard: Math.min(90, retard + 5) })}
            aria-label="5 minutes de retard en plus"
          >
            +5
          </button>
        </div>
        <p className="aide">Ajouté aux heures annoncées, à emporter et en livraison. Revient à zéro chaque nuit.</p>
      </div>

      <div className="tab-bloc tab-ruptures">
        <h2>Épuisés aujourd&apos;hui</h2>
        {enRupture.length > 0 && <p>{enRupture.map((x) => x.nom).join(", ")}</p>}
        <div className="champ">
          <label htmlFor="recherche-plat">Chercher un plat ou un supplément</label>
          <input id="recherche-plat" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
        {plats === null ? (
          <p className="aide">Chargement…</p>
        ) : (
          <ul className="tab-plats">
            {filtres.map((x) => (
              <li key={x.slug}>
                <span>
                  {x.nom} <small>{x.categorie}</small>
                </span>
                <button type="button" className={x.rupture ? "bouton-principal" : "bouton-second"} disabled={envoi} aria-pressed={x.rupture} onClick={() => rupture(x)}>
                  {x.rupture ? "Épuisé" : "Disponible"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {options !== null && options.length > 0 && (
          <>
            <h3>Suppléments</h3>
            {optionsEpuisees.length > 0 && <p>{optionsEpuisees.map((x) => x.nom).join(", ")}</p>}
            <ul className="tab-plats">
              {optionsFiltrees.map((x) => (
                <li key={`${x.groupe}/${x.nom}`}>
                  <span>
                    {x.nom} <small>{x.groupe_nom}</small>
                  </span>
                  <button type="button" className={x.rupture ? "bouton-principal" : "bouton-second"} disabled={envoi} aria-pressed={x.rupture} onClick={() => ruptureOption(x)}>
                    {x.rupture ? "Épuisé" : "Disponible"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="aide">Un plat ou un supplément épuisé redevient disponible tout seul le lendemain.</p>
      </div>
    </section>
  );
}
