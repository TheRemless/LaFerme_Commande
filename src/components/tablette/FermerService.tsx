"use client";

import { useEffect, useState } from "react";
import { poster } from "@/lib/requete-client";

// Fermer le service du jour depuis la tablette (vague 3, D1) : le gérant, ou le responsable de service quand son
// rôle est ouvert. Deux gestes (quand, motif), puis une confirmation qui dit la suite, puis les numéros des
// commandes déjà prises pour ce moment, à traiter dans « En cours ». Le serveur revérifie le droit.

type Quoi = "midi" | "soir" | "journee";
const QUAND: { quoi: Quoi; libelle: string; pour: string }[] = [
  { quoi: "midi", libelle: "Ce midi", pour: "ce midi" },
  { quoi: "soir", libelle: "Ce soir", pour: "ce soir" },
  { quoi: "journee", libelle: "Toute la journée", pour: "aujourd'hui" },
];

export function texteFermeture(pour: string, commandes: number[]): string {
  const prises =
    commandes.length === 0
      ? "Aucune commande déjà prise."
      : commandes.length === 1
        ? `Commande déjà prise : n° ${commandes[0]}. Traitez-la dans « En cours ».`
        : `Commandes déjà prises : n° ${commandes.join(", ")}. Traitez-les dans « En cours ».`;
  return `Fermé pour ${pour}. ${prises}`;
}

export function FermerService({ onChange }: { onChange: () => Promise<void> }) {
  const [autorise, setAutorise] = useState(false);
  const [quoi, setQuoi] = useState<Quoi | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tablette/fermer-service", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAutorise(d?.autorise === true))
      .catch(() => undefined);
  }, []);

  if (!autorise) return null;
  const choix = QUAND.find((q) => q.quoi === quoi) ?? null;
  const motifOk = motif.trim().length >= 2 && motif.trim().length <= 120;

  async function fermer() {
    if (!choix) return;
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/fermer-service", { quoi: choix.quoi, motif: motif.trim() });
    if (r.ok) {
      setFait(texteFermeture(choix.pour, Array.isArray(r.donnees.commandes) ? (r.donnees.commandes as number[]) : []));
      setQuoi(null);
      setMotif("");
      await onChange();
    } else {
      setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    }
    setEnvoi(false);
  }

  return (
    <div className="tab-bloc tab-fermer-service">
      <h2>Fermer le service du jour</h2>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      {fait && (
        <p role="status">
          <strong>{fait}</strong>
        </p>
      )}
      <p>Panne, coup dur : plus aucune commande en ligne pour le moment choisi. Seul le gérant rouvre, au back-office (calendrier).</p>
      <div className="boutons-ligne" role="group" aria-label="Moment à fermer">
        {QUAND.map((q) => (
          <button key={q.quoi} type="button" className={quoi === q.quoi ? "bouton-principal" : "bouton-second"} aria-pressed={quoi === q.quoi} disabled={envoi} onClick={() => setQuoi(q.quoi)}>
            {q.libelle}
          </button>
        ))}
      </div>
      {choix && (
        <>
          <div className="champ">
            <label htmlFor="fermer-motif">Motif, lu par les clients (jamais un nom)</label>
            <input id="fermer-motif" type="text" value={motif} maxLength={120} onChange={(e) => setMotif(e.target.value)} />
          </div>
          <p>Les clients ne pourront plus commander pour {choix.pour}.</p>
          <div className="boutons-ligne">
            <button type="button" className="bouton-principal" disabled={envoi || !motifOk} onClick={fermer}>
              Fermer pour {choix.pour}
            </button>
            <button type="button" className="bouton-second" disabled={envoi} onClick={() => setQuoi(null)}>
              Annuler
            </button>
          </div>
        </>
      )}
    </div>
  );
}
