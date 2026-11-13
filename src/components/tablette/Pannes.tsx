"use client";

import { useCallback, useEffect, useState } from "react";
import { jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import type { Touchee } from "./ruptures";

// « Four en panne… » (vague 3, arbitrage du chef, mêmes mots que le back-office de bo-carte) : tout un poste ou une
// catégorie épuisé jusqu'à ce soir ou demain soir, en deux gestes (la cible, puis la durée). « Remettre en vente »
// d'un geste. Ensuite, les commandes en cours qui contiennent ces plats, chacune ouvrable sur la tablette.

type Rupture = { cible: string; jusqu_au: string };
type Categorie = { slug: string; nom: string };
const JOUR = new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const jourLong = (iso: string) => JOUR.format(new Date(`${iso}T12:00:00Z`));
// « jusqu'à ce soir », « jusqu'à demain soir », sinon « jusqu'au jeudi 20 novembre ».
function jusqua(iso: string): string {
  const aujourdHui = jourGeneveDe(new Date());
  if (iso === aujourdHui) return "jusqu'à ce soir";
  if (iso === new Date(Date.parse(`${aujourdHui}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) return "jusqu'à demain soir";
  return `jusqu'au ${jourLong(iso)}`;
}

function libelle(cible: string, categories: Categorie[]): string {
  if (cible === "poste:pizza") return "Tout le poste pizza";
  if (cible === "poste:cuisine") return "Tout le poste cuisine";
  return `Toute la catégorie « ${categories.find((c) => `categorie:${c.slug}` === cible)?.nom ?? cible.slice(10)} »`;
}

export function Pannes({ onChange, ouvrirCommande }: { onChange: () => Promise<void>; ouvrirCommande: (c: { id: string; numero: number }) => void }) {
  const [etat, setEtat] = useState<{ ruptures: Rupture[]; categories: Categorie[] } | null>(null);
  const [choix, setChoix] = useState<string | null>(null);
  const [categoriesOuvertes, setCategoriesOuvertes] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [touchees, setTouchees] = useState<{ cible: string; commandes: Touchee[] } | null>(null);

  const charger = useCallback(async () => {
    const rep = await fetch("/api/tablette/pannes", { cache: "no-store" }).catch(() => null);
    if (rep?.ok) setEtat(await rep.json());
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function regler(cible: string, jusqu: "ce-soir" | "demain" | null) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/pannes", { cible, jusqu });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    setChoix(null);
    setCategoriesOuvertes(false);
    if (r.ok && jusqu) {
      const rep = await fetch(`/api/tablette/touchees?cible=${encodeURIComponent(cible)}&jusqu_au=${r.donnees.jusqu_au}`, { cache: "no-store" }).catch(() => null);
      setTouchees(rep?.ok ? { cible, commandes: await rep.json() } : null);
    } else if (r.ok) {
      setTouchees(null);
    }
    await charger();
    await onChange();
    setEnvoi(false);
  }

  if (etat === null) return null;
  const actives = etat.ruptures.filter((r) => r.cible.startsWith("poste:") || r.cible.startsWith("categorie:"));
  const prises = new Set(actives.map((r) => r.cible));

  const boutonCible = (cible: string, texte: string) =>
    choix === cible ? (
      <div key={cible} className="tab-panne-duree">
        <p>
          <strong>{libelle(cible, etat.categories)}</strong> épuisé :
        </p>
        <div className="boutons-ligne">
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => regler(cible, "ce-soir")}>
            Jusqu&apos;à ce soir
          </button>
          <button type="button" className="bouton-second" disabled={envoi} onClick={() => regler(cible, "demain")}>
            Jusqu&apos;à demain soir
          </button>
          <button type="button" className="bouton-second" disabled={envoi} onClick={() => setChoix(null)}>
            Annuler
          </button>
        </div>
      </div>
    ) : (
      <button key={cible} type="button" className="bouton-second" disabled={envoi} onClick={() => setChoix(cible)}>
        {texte}
      </button>
    );

  return (
    <div className="tab-bloc tab-pannes">
      <h2>Four en panne…</h2>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      {actives.map((r) => (
        <div key={r.cible} className="tab-panne-active">
          <p>
            <strong>
              {libelle(r.cible, etat.categories)} épuisé {jusqua(r.jusqu_au)}.
            </strong>
          </p>
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => regler(r.cible, null)}>
            Remettre en vente
          </button>
        </div>
      ))}
      <div className="tab-panne-cibles">
        {!prises.has("poste:pizza") && boutonCible("poste:pizza", "Four en panne")}
        {!prises.has("poste:cuisine") && boutonCible("poste:cuisine", "Cuisine en panne")}
        {!choix?.startsWith("categorie:") && (
          <button type="button" className="bouton-second" disabled={envoi} aria-expanded={categoriesOuvertes} onClick={() => setCategoriesOuvertes(!categoriesOuvertes)}>
            Une catégorie…
          </button>
        )}
      </div>
      {(categoriesOuvertes || choix?.startsWith("categorie:")) && (
        <div className="tab-panne-cibles">
          {etat.categories.filter((c) => !prises.has(`categorie:${c.slug}`)).map((c) => boutonCible(`categorie:${c.slug}`, c.nom))}
        </div>
      )}
      {touchees && <CommandesTouchees commandes={touchees.commandes} ouvrir={ouvrirCommande} fermer={() => setTouchees(null)} />}
      <p className="aide">Le client voit ces plats épuisés. Ils reviennent seuls à la date dite.</p>
    </div>
  );
}

// « Commandes en cours qui les contiennent » : à prévenir ou à corriger (manque), chacune s'ouvre sur la tablette.
export function CommandesTouchees({ commandes, ouvrir, fermer }: { commandes: Touchee[]; ouvrir: (c: { id: string; numero: number }) => void; fermer: () => void }) {
  const aujourdHui = jourGeneveDe(new Date());
  return (
    <div className="tab-touchees" role="status">
      {commandes.length === 0 ? (
        <p>Aucune commande en cours ne les contient.</p>
      ) : (
        <>
          <p>
            <strong>Commandes en cours qui les contiennent :</strong>
          </p>
          <ul>
            {commandes.map((c) => (
              <li key={c.id}>
                <button type="button" className="bouton-second" onClick={() => ouvrir(c)}>
                  N° {c.numero}
                </button>
                <span>
                  {c.jour && c.jour !== aujourdHui ? `${jourLong(c.jour)}, ` : ""}
                  {c.statut === "nouvelle" ? "à accepter" : "en cours"}, {c.lignes.map((l) => `${l.qte} × ${l.nom}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="bouton-second" onClick={fermer}>
        Vu
      </button>
    </div>
  );
}
