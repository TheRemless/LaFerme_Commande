"use client";

import { useState } from "react";
import type { PlatGestion } from "@/components/gestion/GestionCarte";
import { enregistrer } from "@/components/gestion/enregistrer";
import { useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";

// Parties de la fiche d'un plat ajoutées à la vague 3 : disponibilités, rupture jusqu'à une date, copie.

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function DispoRupture({ plat, aujourdhui, recharger }: { plat: PlatGestion; aujourdhui: string; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const duJour = plat.origine === "jour";
  const [service, setService] = useState(plat.dispo?.service ?? "");
  const [mode, setMode] = useState(plat.dispo?.mode ?? "");
  const [jours, setJours] = useState<number[]>(plat.dispo?.jours ?? [1, 2, 3, 4, 5, 6, 7]);
  const [date, setDate] = useState(plat.rupture_jusqu_au?.slice(0, 10) ?? aujourdhui.slice(0, 10));
  const [envoi, setEnvoi] = useState(false);

  async function sauverDispo(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    const dispo = { service: service || null, mode: mode || null, jours: duJour ? null : jours };
    const erreur = await enregistrer("/api/gestion/carte", { type: "disponibilite", slug: plat.slug, dispo });
    setEnvoi(false);
    notifier(erreur ? { texte: erreur, ton: "erreur" } : { texte: "Disponibilités enregistrées.", ton: "succes" });
    if (!erreur) await recharger();
  }
  async function rupture(jusqu: string | null) {
    setEnvoi(true);
    const erreur = await enregistrer("/api/gestion/carte", { type: "rupture", slug: plat.slug, jusqu_au: jusqu });
    setEnvoi(false);
    notifier(
      erreur
        ? { texte: erreur, ton: "erreur" }
        : { texte: jusqu ? `Épuisé jusqu'au ${jourTexte(jusqu)}, de retour le lendemain.` : "De nouveau en vente.", ton: "succes" },
    );
    if (!erreur) await recharger();
  }

  return (
    <section className="bo-fiche-partie" aria-labelledby={`dispo-${plat.slug}`}>
      <h3 id={`dispo-${plat.slug}`}>Disponibilités</h3>
      <form onSubmit={sauverDispo} className="bo-formulaire">
        {!duJour && (
          <fieldset className="bo-choix">
            <legend>Service</legend>
            {[["", "Midi et soir"], ["midi", "Midi seulement"], ["soir", "Soir seulement"]].map(([v, t]) => (
              <label key={v} className="bo-case">
                <input type="radio" name={`service-${plat.slug}`} checked={service === v} onChange={() => setService(v as never)} />
                <span>{t}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="bo-choix">
          <legend>Livraison ou à emporter</legend>
          {[["", "Les deux"], ["livraison", "Livraison seulement"], ["retrait", "À emporter seulement"]].map(([v, t]) => (
            <label key={v} className="bo-case">
              <input type="radio" name={`mode-${plat.slug}`} checked={mode === v} onChange={() => setMode(v as never)} />
              <span>{t}</span>
            </label>
          ))}
        </fieldset>
        {!duJour && (
          <fieldset className="bo-choix">
            <legend>Jours</legend>
            {JOURS.map((j, i) => (
              <label key={j} className="bo-case">
                <input
                  type="checkbox"
                  checked={jours.includes(i + 1)}
                  onChange={(e) => setJours((js) => (e.target.checked ? [...js, i + 1].sort() : js.filter((x) => x !== i + 1)))}
                />
                <span>{j}</span>
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" className="bo-bouton bo-bouton-second" disabled={envoi || (!duJour && jours.length === 0)}>
          Enregistrer les disponibilités
        </button>
        {!duJour && jours.length === 0 && <p className="bo-champ-aide">Cochez au moins un jour.</p>}
      </form>

      <h3>Rupture</h3>
      {plat.rupture_jusqu_au ? (
        <p>
          Épuisé jusqu&apos;au {jourTexte(plat.rupture_jusqu_au.slice(0, 10))} compris.{" "}
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" disabled={envoi} onClick={() => rupture(null)}>
            Remettre en vente
          </button>
        </p>
      ) : (
        <p className="bo-champ-aide">En vente. La tablette épuise un plat pour le jour ; ici, jusqu&apos;à une date.</p>
      )}
      <div className="bo-ligne-champs">
        <div className="bo-champ">
          <label htmlFor={`rupture-${plat.slug}`}>Épuisé jusqu&apos;au (compris)</label>
          <input id={`rupture-${plat.slug}`} type="date" value={date} min={aujourdhui.slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="button" className="bo-bouton bo-bouton-second" disabled={envoi || !date} onClick={() => rupture(date)}>
          Épuiser
        </button>
      </div>
    </section>
  );
}

// Étiquettes : posées par le gérant seulement, jamais déduites de la description ou des allergènes.
export const ETIQUETTES: [string, string][] = [
  ["vegetarien", "Végétarien"],
  ["vegane", "Végane"],
  ["epice", "Épicé"],
];

export function Etiquettes({ plat, recharger }: { plat: PlatGestion; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const [choisies, setChoisies] = useState<string[]>(plat.etiquettes ?? []);
  const [envoi, setEnvoi] = useState(false);
  async function sauver() {
    setEnvoi(true);
    const erreur = await enregistrer("/api/gestion/carte", { type: "etiquettes", slug: plat.slug, etiquettes: choisies });
    setEnvoi(false);
    notifier(erreur ? { texte: erreur, ton: "erreur" } : { texte: "Étiquettes enregistrées.", ton: "succes" });
    if (!erreur) await recharger();
  }
  return (
    <section className="bo-fiche-partie" aria-labelledby={`etiquettes-${plat.slug}`}>
      <h3 id={`etiquettes-${plat.slug}`}>Étiquettes</h3>
      <p className="bo-champ-aide">Montrées au client et utilisées par le filtre de la carte. À cocher seulement si le restaurant l&apos;a vérifié. Végane coche aussi végétarien.</p>
      <fieldset className="bo-choix">
        <legend className="sr-only">Étiquettes du plat</legend>
        {ETIQUETTES.map(([v, t]) => (
          <label key={v} className="bo-case">
            <input type="checkbox" checked={choisies.includes(v)} onChange={(e) => setChoisies((c) => (e.target.checked ? [...c, v] : c.filter((x) => x !== v)))} />
            <span>{t}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className="bo-bouton bo-bouton-second" disabled={envoi} onClick={sauver}>
        Enregistrer les étiquettes
      </button>
    </section>
  );
}

export function CopierPlat({ plat, copie }: { plat: PlatGestion; copie: (slug: string) => Promise<void> }) {
  const notifier = useNotifier();
  const [nom, setNom] = useState(`${plat.nom} (copie)`);
  const [envoi, setEnvoi] = useState(false);
  async function copier(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    const r = await poster("/api/gestion/carte", { type: "dupliquer", slug: plat.slug, nom });
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: `${nom} créé, hors de la vente.`, ton: "succes" });
    await copie(String(r.donnees.slug));
  }
  return (
    <section className="bo-fiche-partie" aria-labelledby={`copie-${plat.slug}`}>
      <h3 id={`copie-${plat.slug}`}>Copier ce plat</h3>
      <form onSubmit={copier} className="bo-ligne-champs">
        <div className="bo-champ">
          <label htmlFor={`copie-nom-${plat.slug}`}>Nom de la copie</label>
          <input id={`copie-nom-${plat.slug}`} value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)} />
        </div>
        <button type="submit" className="bo-bouton bo-bouton-second" disabled={envoi || !nom.trim()}>
          Copier
        </button>
      </form>
      <p className="bo-champ-aide">Même catégorie, prix, options et retraits ; hors de la vente jusqu&apos;à ce que vous la mettiez en vente.</p>
    </section>
  );
}
