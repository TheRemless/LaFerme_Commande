"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useConfirmer, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Décaler les commandes en cours (vague 3, bo-operations), rubrique Livraison et horaires, sous le coup de feu.
// Le coup de feu touche les commandes à venir ; ce geste-ci, celles déjà acceptées. Route /api/gestion/decalage,
// doc docs/decaler-commandes.md. La tablette a le même geste.

const URL = "/api/gestion/decalage";
const MINUTES = [5, 10, 15, 20, 25, 30, 45, 60];
type Poste = "" | "pizza" | "cuisine";
const POSTES: [Poste, string][] = [
  ["", "Tous les postes"],
  ["pizza", "Four (les commandes avec pizzas)"],
  ["cuisine", "Cuisine (les commandes avec plats)"],
];

export function DecalerCommandes() {
  const ids = useId();
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [minutes, setMinutes] = useState(15);
  const [poste, setPoste] = useState<Poste>("");
  const [apercu, setApercu] = useState<{ commandes: number; clients: number } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const lire = useCallback(async () => {
    const r = await fetch(`${URL}${poste ? `?poste=${poste}` : ""}`, { cache: "no-store" }).catch(() => null);
    setApercu(r?.ok ? await r.json() : null);
  }, [poste]);
  useEffect(() => {
    lire();
    // Les commandes avancent pendant le service : l'aperçu se relit chaque minute.
    const t = window.setInterval(lire, 60_000);
    return () => window.clearInterval(t);
  }, [lire]);

  async function decaler(e: React.FormEvent) {
    e.preventDefault();
    if (!apercu || apercu.commandes === 0) return;
    const ou = poste === "pizza" ? " au four" : poste === "cuisine" ? " en cuisine" : "";
    const ok = await confirmer({
      titre: `Décaler de ${minutes} min ${apercu.commandes} commande${apercu.commandes > 1 ? "s" : ""}${ou} ?`,
      texte: `Leur heure promise recule de ${minutes} minutes. ${apercu.clients} client${apercu.clients > 1 ? "s reçoivent" : " reçoit"} un e-mail avec la nouvelle heure, un seul par commande. Les commandes pour plus tard ne bougent pas.`,
      oui: `Décaler de ${minutes} min`,
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster(URL, { minutes, poste: poste || null, cle: crypto.randomUUID() });
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    const n = Number(r.donnees.commandes ?? 0);
    const p = Number(r.donnees.prevenus ?? 0);
    notifier({
      texte: `${n} commande${n > 1 ? "s" : ""} décalée${n > 1 ? "s" : ""} de ${minutes} min. ${p} e-mail${p > 1 ? "s" : ""} envoyé${p > 1 ? "s" : ""}.`,
      ton: "succes",
    });
    await lire();
  }

  return (
    <section className="ges-bloc bo-decaler" aria-labelledby={`${ids}-titre`}>
      <h2 id={`${ids}-titre`}>Retard sur les commandes en cours</h2>
      <p className="aide">
        Le four ou la cuisine prend du retard sur des commandes déjà acceptées : leur heure promise recule d&apos;un geste et chaque client est prévenu par
        e-mail. Seules les commandes acceptées ou en préparation des 90 prochaines minutes bougent.
      </p>
      <form className="bo-decaler-form" onSubmit={decaler}>
        <div className="bo-champ">
          <label htmlFor={`${ids}-minutes`}>Retard</label>
          <select id={`${ids}-minutes`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                +{m} min
              </option>
            ))}
          </select>
        </div>
        <fieldset className="bo-decaler-postes">
          <legend>Commandes</legend>
          {POSTES.map(([v, texte]) => (
            <label key={v || "tous"}>
              <input type="radio" name={`${ids}-poste`} checked={poste === v} onChange={() => setPoste(v)} />
              <span>{texte}</span>
            </label>
          ))}
        </fieldset>
        <p className="bo-decaler-apercu" role="status">
          {apercu === null
            ? "Commandes en cours : pas lues."
            : apercu.commandes === 0
              ? "Aucune commande en cours à décaler."
              : `${apercu.commandes} commande${apercu.commandes > 1 ? "s" : ""} en cours, ${apercu.clients} client${apercu.clients > 1 ? "s" : ""} prévenu${apercu.clients > 1 ? "s" : ""} par e-mail.`}
        </p>
        <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi || !apercu || apercu.commandes === 0}>
          {envoi ? "Décalage…" : `Décaler de ${minutes} min`}
        </button>
      </form>
    </section>
  );
}
