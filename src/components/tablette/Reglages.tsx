"use client";

import { useEffect, useMemo, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { CoupDeFeu } from "./CoupDeFeu";
import { Pannes } from "./Pannes";
import { derniereOptionObligatoire, parGroupe, rupturePlanifiee, texteRupture, type OptionRupture, type PlatRupture } from "./ruptures";

type Props = {
  reglages: { pause: { active: boolean; jusqua: string | null; livraisonFermee: boolean } | null; preparation_minutes: number; retard_minutes?: number };
  onChange: () => Promise<void>;
};

type Plat = PlatRupture;
// Supplément ou choix (audit du gérant, G07) : épuisé pour la journée comme un plat.
type Option = OptionRupture;
// Geste qui demande une confirmation sur sa ligne (rupture planifiée, dernière option d'un choix obligatoire).
type Confirmation = { cle: string; message: string; bouton: string; faire: () => Promise<void> };


// Pause des commandes en ligne, livraison, délai de préparation et ruptures du jour.
export function Reglages({ reglages, onChange }: Props) {
  const [plats, setPlats] = useState<Plat[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const [options, setOptions] = useState<Option[] | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const aujourdHui = jourGeneveDe(new Date());
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

  function demanderOption(o: Option) {
    if (options && derniereOptionObligatoire(options, o)) {
      setConfirmation({
        cle: `o:${o.groupe}/${o.nom}`,
        message: `Dernier choix disponible dans « ${o.groupe_nom} » : les plats qui l'exigent ne pourront plus être commandés.`,
        bouton: "Épuiser quand même",
        faire: () => ruptureOption(o),
      });
    } else if (rupturePlanifiee(o, aujourdHui)) {
      setConfirmation({ cle: `o:${o.groupe}/${o.nom}`, message: `${texteRupture(o, aujourdHui)}, posé au back-office.`, bouton: "Remettre dès maintenant", faire: () => ruptureOption(o) });
    } else {
      void ruptureOption(o);
    }
  }

  function demanderPlat(p: Plat) {
    if (rupturePlanifiee(p, aujourdHui)) {
      setConfirmation({ cle: `p:${p.slug}`, message: `${texteRupture(p, aujourdHui)}, posé au back-office.`, bouton: "Remettre dès maintenant", faire: () => rupture(p) });
    } else {
      void rupture(p);
    }
  }

  async function ruptureOption(o: Option) {
    setConfirmation(null);
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/options", { groupe: o.groupe, nom: o.nom, rupture: !o.rupture });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await chargerPlats();
    setEnvoi(false);
  }

  async function rupture(p: Plat) {
    setConfirmation(null);
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
  // Panne d'un poste : dite dans son bloc, pas plat par plat ici.
  const enRupture = (plats ?? []).filter((x) => x.rupture && !x.rupture_groupee);
  const optionsEpuisees = (options ?? []).filter((x) => x.rupture);
  const optionsFiltrees = (options ?? []).filter((x) => !recherche.trim() || x.nom.toLowerCase().includes(recherche.trim().toLowerCase()));

  return (
    <section className="tab-reglages" aria-label="Réglages du service">
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <CoupDeFeu onChange={onChange} />
      <Pannes
        onChange={async () => {
          await chargerPlats();
          await onChange();
        }}
      />

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
            {filtres.map((x) => {
              const motif = texteRupture(x, aujourdHui);
              const groupee = !!x.rupture_groupee;
              return (
                <li key={x.slug}>
                  <span>
                    {x.nom} <small>{x.categorie}</small>
                    {motif && motif !== "Épuisé aujourd'hui" && <small className="tab-rupture-motif">{motif}</small>}
                  </span>
                  <button
                    type="button"
                    className={x.rupture || groupee ? "bouton-principal" : "bouton-second"}
                    disabled={envoi || groupee}
                    aria-pressed={x.rupture || groupee}
                    onClick={() => demanderPlat(x)}
                  >
                    {x.rupture || groupee ? "Épuisé" : "Disponible"}
                  </button>
                  {confirmation?.cle === `p:${x.slug}` && <LigneConfirmation c={confirmation} envoi={envoi} annuler={() => setConfirmation(null)} />}
                </li>
              );
            })}
          </ul>
        )}
        {options !== null && optionsFiltrees.length > 0 && (
          <>
            <h3>Suppléments et choix</h3>
            {optionsEpuisees.length > 0 && <p>{optionsEpuisees.map((x) => x.nom).join(", ")}</p>}
            {parGroupe(optionsFiltrees).map((g) => (
              <div key={g.groupe} className="tab-groupe-options">
                <h4>
                  {g.nom}
                  {g.obligatoire && <small> choix obligatoire</small>}
                </h4>
                <ul className="tab-plats">
                  {g.options.map((x) => {
                    const motif = texteRupture(x, aujourdHui);
                    return (
                      <li key={`${x.groupe}/${x.nom}`}>
                        <span>
                          {x.nom}
                          {motif && motif !== "Épuisé aujourd'hui" && <small className="tab-rupture-motif">{motif}</small>}
                        </span>
                        <button type="button" className={x.rupture ? "bouton-principal" : "bouton-second"} disabled={envoi} aria-pressed={x.rupture} onClick={() => demanderOption(x)}>
                          {x.rupture ? "Épuisé" : "Disponible"}
                        </button>
                        {confirmation?.cle === `o:${x.groupe}/${x.nom}` && <LigneConfirmation c={confirmation} envoi={envoi} annuler={() => setConfirmation(null)} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
        <p className="aide">Un plat ou un supplément épuisé redevient disponible tout seul le lendemain.</p>
      </div>
    </section>
  );
}

// Confirmation sur la ligne du plat ou de l'option, sans fenêtre par-dessus la liste.
function LigneConfirmation({ c, envoi, annuler }: { c: Confirmation; envoi: boolean; annuler: () => void }) {
  return (
    <div className="tab-confirmation" role="alert">
      <p>{c.message}</p>
      <div className="boutons-ligne">
        <button type="button" className="bouton-principal" disabled={envoi} onClick={() => void c.faire()}>
          {c.bouton}
        </button>
        <button type="button" className="bouton-second" disabled={envoi} onClick={annuler}>
          Annuler
        </button>
      </div>
    </div>
  );
}
