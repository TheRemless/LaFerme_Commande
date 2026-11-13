"use client";

import { useCallback, useEffect, useState } from "react";
import { Champ, EtatErreur, useConfirmer, useNotifier } from "@/components/gestion/ui";
import { heureTexte, instantGeneve } from "@/lib/service";
import { poster } from "@/lib/requete-client";

// Coup de feu au back-office (vague 3, bo-operations) : un geste qui durcit le service un soir chargé, puis tout
// revient seul. Route /api/gestion/coup-de-feu (gérant), doc docs/coup-de-feu.md. La tablette a son bouton.

type Applique = { retard_minutes?: number; livraison_fermee?: boolean; capacite_livraisons_par_creneau?: number; capacite_retraits_par_creneau?: number };
type Etat = {
  en_cours: { debut: string; jusqua: string; par: string | null; applique: Applique } | null;
  defaut: { retard_minutes: number; duree_minutes: number; capacite_livraison: number | null; capacite_retrait: number | null; livraison_fermee: boolean };
  defaut_propose: boolean;
};

const URL = "/api/gestion/coup-de-feu";
const DUREES: [number, string][] = [
  [30, "30 minutes"],
  [60, "1 heure"],
  [90, "1 h 30"],
  [120, "2 heures"],
  [180, "3 heures"],
  [240, "4 heures"],
];
const heure = (iso: string) => heureTexte(instantGeneve(new Date(iso)).minutes);

// Ce que le geste change, en clair (« +20 min sur les heures annoncées », « 2 livraisons par créneau »).
export function resumeApplique(a: Applique): string[] {
  const l: string[] = [];
  if (a.retard_minutes) l.push(`Heures annoncées : ${a.retard_minutes} min de retard en tout`);
  if (a.capacite_livraisons_par_creneau) l.push(`${a.capacite_livraisons_par_creneau} livraison${a.capacite_livraisons_par_creneau > 1 ? "s" : ""} au plus par créneau`);
  if (a.capacite_retraits_par_creneau) l.push(`${a.capacite_retraits_par_creneau} retrait${a.capacite_retraits_par_creneau > 1 ? "s" : ""} au plus par créneau`);
  if (a.livraison_fermee) l.push("Livraison fermée, retrait seulement");
  return l;
}

export function CoupDeFeu() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async () => {
    try {
      const r = await fetch(URL, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.erreur ?? "Coup de feu indisponible."));
      setEtat(d);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Coup de feu indisponible.");
    }
  }, []);
  useEffect(() => {
    charger();
    // Il peut finir seul ou être lancé depuis la tablette : relu chaque minute.
    const t = window.setInterval(charger, 60_000);
    return () => window.clearInterval(t);
  }, [charger]);

  return (
    <section className="ges-bloc bo-cdf" aria-labelledby="cdf-titre">
      <h2 id="cdf-titre">Coup de feu</h2>
      {erreur && !etat ? (
        <EtatErreur texte={erreur} reessayer={charger} />
      ) : !etat ? (
        <p className="aide">Chargement…</p>
      ) : etat.en_cours ? (
        <EnCours etat={etat} recharger={charger} />
      ) : (
        <Lancer etat={etat} recharger={charger} />
      )}
    </section>
  );
}

function EnCours({ etat, recharger }: { etat: Etat; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const c = etat.en_cours!;
  async function finir() {
    const ok = await confirmer({ titre: "Finir le coup de feu ?", texte: "Le retard, la capacité et la livraison reviennent comme avant, sauf ce qui a été changé entre-temps.", oui: "Finir le coup de feu" });
    if (!ok) return;
    const r = await poster(URL, { action: "finir" });
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: r.donnees.deja ? "Le coup de feu était déjà fini." : "Coup de feu fini.", ton: "succes" });
    await recharger();
  }
  return (
    <div className="bo-cdf-encours" role="status">
      <p className="bo-cdf-titre">
        En cours jusqu&apos;à <strong>{heure(c.jusqua)}</strong>
        {c.par ? `, lancé par ${c.par} à ${heure(c.debut)}` : ""}.
      </p>
      <ul>
        {resumeApplique(c.applique).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="aide">À {heure(c.jusqua)}, tout revient comme avant. Pour prolonger, finissez puis relancez.</p>
      <button type="button" className="bo-bouton bo-bouton-second" onClick={finir}>
        Finir le coup de feu
      </button>
    </div>
  );
}

function Lancer({ etat, recharger }: { etat: Etat; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const d = etat.defaut;
  const [v, setV] = useState({
    retard: String(d.retard_minutes),
    duree: String(d.duree_minutes),
    livraisons: d.capacite_livraison === null ? "" : String(d.capacite_livraison),
    retraits: d.capacite_retrait === null ? "" : String(d.capacite_retrait),
    fermee: d.livraison_fermee,
  });
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);

  function corps() {
    const e: Record<string, string> = {};
    const nb = (s: string, min: number, max: number) => (/^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max ? Number(s) : null);
    const retard = v.retard.trim() === "" ? 0 : nb(v.retard, 0, 90);
    if (retard === null) e.retard = "De 0 à 90 minutes.";
    const livraisons = v.livraisons.trim() === "" ? null : nb(v.livraisons, 1, 50);
    if (v.livraisons.trim() !== "" && livraisons === null) e.livraisons = "De 1 à 50, ou vide pour ne pas changer.";
    const retraits = v.retraits.trim() === "" ? null : nb(v.retraits, 1, 50);
    if (v.retraits.trim() !== "" && retraits === null) e.retraits = "De 1 à 50, ou vide pour ne pas changer.";
    if (!e.retard && !e.livraisons && !e.retraits && !retard && !livraisons && !retraits && !v.fermee) e.retard = "Choisissez au moins un changement.";
    setErreurs(e);
    if (Object.keys(e).length) return null;
    return { action: "lancer", retard_minutes: retard, duree_minutes: Number(v.duree), capacite_livraison: livraisons, capacite_retrait: retraits, livraison_fermee: v.fermee };
  }

  async function lancer(e: React.FormEvent) {
    e.preventDefault();
    const c = corps();
    if (!c) return;
    const fin = heureTexte((instantGeneve(new Date()).minutes + c.duree_minutes) % 1440);
    const changements = resumeApplique({
      retard_minutes: c.retard_minutes || undefined,
      capacite_livraisons_par_creneau: c.capacite_livraison ?? undefined,
      capacite_retraits_par_creneau: c.capacite_retrait ?? undefined,
      livraison_fermee: c.livraison_fermee || undefined,
    });
    const ok = await confirmer({
      titre: `Lancer le coup de feu jusqu'à ${fin} ?`,
      texte: (
        <ul>
          {changements.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ),
      oui: "Lancer le coup de feu",
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster(URL, c);
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: `Coup de feu lancé jusqu'à ${fin}.`, ton: "succes" });
    await recharger();
  }

  return (
    <form className="bo-cdf-form" onSubmit={lancer} noValidate>
      <p className="aide">
        Un soir chargé, en un geste : plus de temps sur les heures annoncées, moins de commandes par créneau, la livraison fermée si besoin. Tout revient seul à
        l&apos;heure choisie.
        {etat.defaut_propose ? " Valeurs proposées, en attente de la validation de Jérémy : vous pouvez les changer avant de lancer." : ""}
      </p>
      <div className="bo-cdf-champs">
        <Champ libelle="Retard en tout (min)" aide="Le plus long gagne : un retard déjà plus grand reste." erreur={erreurs.retard}>
          {(a) => <input {...a} inputMode="numeric" value={v.retard} onChange={(e) => setV({ ...v, retard: e.target.value })} />}
        </Champ>
        <Champ libelle="Livraisons par créneau, au plus" aide="Vide : ne pas changer." erreur={erreurs.livraisons} facultatif>
          {(a) => <input {...a} inputMode="numeric" value={v.livraisons} onChange={(e) => setV({ ...v, livraisons: e.target.value })} />}
        </Champ>
        <Champ libelle="Retraits par créneau, au plus" aide="Vide : ne pas changer." erreur={erreurs.retraits} facultatif>
          {(a) => <input {...a} inputMode="numeric" value={v.retraits} onChange={(e) => setV({ ...v, retraits: e.target.value })} />}
        </Champ>
        <Champ libelle="Pendant">
          {(a) => (
            <select {...a} value={v.duree} onChange={(e) => setV({ ...v, duree: e.target.value })}>
              {/* La durée proposée, si elle n'est pas dans la liste, y est ajoutée. */}
              {(DUREES.some(([m]) => m === d.duree_minutes) ? DUREES : [...DUREES, [d.duree_minutes, `${d.duree_minutes} minutes`] as [number, string]]).map(([m, texte]) => (
                <option key={m} value={String(m)}>
                  {texte}
                </option>
              ))}
            </select>
          )}
        </Champ>
      </div>
      <label className="bo-cdf-case">
        <input type="checkbox" checked={v.fermee} onChange={(e) => setV({ ...v, fermee: e.target.checked })} />
        <span>Fermer la livraison (retrait seulement)</span>
      </label>
      <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
        {envoi ? "Lancement…" : "Lancer le coup de feu"}
      </button>
    </form>
  );
}
