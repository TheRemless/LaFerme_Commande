"use client";

import { useEffect, useMemo, useState } from "react";
import { poster } from "@/lib/requete-client";

type Props = {
  reglages: { pause: { active: boolean; jusqua: string | null; livraisonFermee: boolean } | null; preparation_minutes: number };
  onChange: () => Promise<void>;
};

type Plat = { slug: string; nom: string; categorie: string; rupture: boolean };

function heure(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(":", "h");
}

// Pause des commandes en ligne, livraison, délai de préparation et ruptures du jour.
export function Reglages({ reglages, onChange }: Props) {
  const [plats, setPlats] = useState<Plat[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function chargerPlats() {
    const rep = await fetch("/api/tablette/plats", { cache: "no-store" }).catch(() => null);
    if (rep?.ok) setPlats(await rep.json());
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

  async function rupture(p: Plat) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/plats", { slug: p.slug, rupture: !p.rupture });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await chargerPlats();
    setEnvoi(false);
  }

  const p = reglages.pause;
  const enPause = p?.active && (!p.jusqua || new Date(p.jusqua).getTime() > Date.now());
  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (plats ?? []).filter((x) => !q || x.nom.toLowerCase().includes(q));
  }, [plats, recherche]);
  const enRupture = (plats ?? []).filter((x) => x.rupture);

  return (
    <section className="tab-reglages" aria-label="Réglages du service">
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="tab-bloc">
        <h2>Commandes en ligne</h2>
        <p>{enPause ? (p?.jusqua ? `En pause jusqu'à ${heure(p.jusqua)}. Elles reprennent seules.` : "En pause jusqu'à ce que vous repreniez.") : "Ouvertes."}</p>
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
        <h2>Délai de préparation</h2>
        <div className="tab-delai">
          <button
            type="button"
            className="bouton-second"
            disabled={envoi || reglages.preparation_minutes <= 5}
            onClick={() => regler({ preparation: reglages.preparation_minutes - 5 })}
            aria-label="Cinq minutes de moins"
          >
            −5
          </button>
          <p aria-live="polite">{reglages.preparation_minutes} min</p>
          <button
            type="button"
            className="bouton-second"
            disabled={envoi || reglages.preparation_minutes >= 120}
            onClick={() => regler({ preparation: reglages.preparation_minutes + 5 })}
            aria-label="Cinq minutes de plus"
          >
            +5
          </button>
        </div>
        <p className="aide">Sert à l&apos;heure « dès que possible » proposée aux clients pour le retrait.</p>
      </div>

      <div className="tab-bloc tab-ruptures">
        <h2>Épuisés aujourd&apos;hui</h2>
        {enRupture.length > 0 && <p>{enRupture.map((x) => x.nom).join(", ")}</p>}
        <div className="champ">
          <label htmlFor="recherche-plat">Chercher un plat</label>
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
        <p className="aide">Un plat épuisé redevient disponible tout seul le lendemain.</p>
      </div>
    </section>
  );
}
