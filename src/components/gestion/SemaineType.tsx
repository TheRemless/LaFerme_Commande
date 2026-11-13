"use client";

import { useId, useState } from "react";
import { useConfirmer, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Jours fermés chaque semaine (vague 3, bo-operations ; demande de Jérémy du 13.11.2026). Onglet Horaires de la
// rubrique Livraison et horaires : fermer un service chaque semaine (le mercredi midi, tout le lundi) ou en ouvrir
// un (le dimanche soir). Les fermetures et ouvertures d'un jour précis sont dans l'onglet Fermetures.
// Route /api/gestion/service (semaine-fermer, semaine-ouvrir, semaine-commandes). Doc : docs/calendrier.md.

type Service = "midi" | "soir";
type Horaire = { id: number; jour: number; service: Service; premiere_heure: string; derniere_heure: string; derniere_commande: string; derniere_commande_pizzas: string };
type Heures = { premiere_heure: string; derniere_heure: string; derniere_commande: string; derniere_commande_pizzas: string };

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const SERVICES: Service[] = ["midi", "soir"];
const hm = (t: string) => t.slice(0, 5);
const h = (t: string) => hm(t).replace(":", "h");
const CHAMPS: [keyof Heures, string][] = [
  ["premiere_heure", "Première heure"],
  ["derniere_heure", "Dernière heure"],
  ["derniere_commande", "Dernière commande"],
  ["derniere_commande_pizzas", "Dernière pizza"],
];
const URL = "/api/gestion/service";

// Heures proposées pour ouvrir : celles du même service un autre jour, sinon vides (à saisir).
function heuresDe(horaires: Horaire[], service: Service): Heures {
  const modele = horaires.find((x) => x.service === service);
  return modele
    ? { premiere_heure: hm(modele.premiere_heure), derniere_heure: hm(modele.derniere_heure), derniere_commande: hm(modele.derniere_commande), derniere_commande_pizzas: hm(modele.derniere_commande_pizzas) }
    : { premiere_heure: "", derniere_heure: "", derniere_commande: "", derniere_commande_pizzas: "" };
}

export function SemaineType({ horaires, recharger }: { horaires: Horaire[]; recharger: () => Promise<void> }) {
  const ids = useId();
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [ouvrir, setOuvrir] = useState<{ jour: number; service: Service; heures: Heures } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const de = (jour: number, service: Service) => horaires.find((x) => x.jour === jour && x.service === service);
  const nom = (jour: number, service: Service) => `${JOURS[jour].toLowerCase()} ${service}`;

  async function fermer(jour: number, services: Service[]) {
    // Commandes déjà prises pour ce jour de la semaine : dites avant de fermer.
    let prises = 0;
    for (const s of services) {
      const r = await poster(URL, { type: "semaine-commandes", jour, service: s });
      prises += r.ok ? Number(r.donnees.commandes ?? 0) : 0;
    }
    const quoi = services.length === 2 ? `le ${JOURS[jour].toLowerCase()} toute la journée` : `le ${nom(jour, services[0])}`;
    const ok = await confirmer({
      titre: `Fermer ${quoi}, chaque semaine ?`,
      texte:
        `Les clients ne pourront plus commander pour ${quoi}, à partir d'aujourd'hui et toutes les semaines. ` +
        (prises > 0
          ? `${prises} commande${prises > 1 ? "s" : ""} déjà prise${prises > 1 ? "s" : ""} pour un ${JOURS[jour].toLowerCase()} à venir reste${prises > 1 ? "nt" : ""} valable${prises > 1 ? "s" : ""} : appelez les clients ou annulez sur la tablette.`
          : "Aucune commande déjà prise n'est touchée."),
      oui: "Fermer chaque semaine",
      danger: true,
    });
    if (!ok) return;
    setEnvoi(true);
    for (const s of services) {
      const r = await poster(URL, { type: "semaine-fermer", jour, service: s });
      if (!r.ok) {
        setEnvoi(false);
        return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
      }
    }
    setEnvoi(false);
    notifier({ texte: `Fermé chaque semaine : ${quoi}.`, ton: "succes" });
    await recharger();
  }

  async function valider(e: React.FormEvent) {
    e.preventDefault();
    if (!ouvrir) return;
    setEnvoi(true);
    const r = await poster(URL, { type: "semaine-ouvrir", jour: ouvrir.jour, service: ouvrir.service, champs: ouvrir.heures });
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: `Ouvert chaque semaine : le ${nom(ouvrir.jour, ouvrir.service)}, de ${h(ouvrir.heures.premiere_heure)} à ${h(ouvrir.heures.derniere_heure)}.`, ton: "succes" });
    setOuvrir(null);
    await recharger();
  }

  return (
    <section className="ges-bloc bo-semaine" aria-labelledby={`${ids}-titre`}>
      <h2 id={`${ids}-titre`}>Semaine type</h2>
      <p className="aide">
        Les services ouverts chaque semaine. Fermer un jour fixe ici (chaque mercredi midi, tout le lundi), ou en ouvrir un. Pour un jour précis (vacances,
        fête), voir l&apos;onglet Fermetures. Heures de Genève.
      </p>
      <table className="bo-semaine-table">
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Midi</th>
            <th scope="col">Soir</th>
            <th scope="col">
              <span className="sr-only">Journée</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map((jour) => (
            <tr key={jour}>
              <th scope="row">{JOURS[jour]}</th>
              {SERVICES.map((s) => {
                const x = de(jour, s);
                return (
                  <td key={s} data-ouvert={x ? "oui" : "non"}>
                    <span className="bo-semaine-etat">{x ? `${h(x.premiere_heure)} à ${h(x.derniere_heure)}` : "Fermé"}</span>
                    {x ? (
                      <button type="button" className="bo-bouton bo-bouton-discret" disabled={envoi} onClick={() => fermer(jour, [s])} aria-label={`Fermer le ${nom(jour, s)} chaque semaine`}>
                        Fermer
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bo-bouton bo-bouton-discret"
                        disabled={envoi}
                        onClick={() => setOuvrir({ jour, service: s, heures: heuresDe(horaires, s) })}
                        aria-label={`Ouvrir le ${nom(jour, s)} chaque semaine`}
                      >
                        Ouvrir
                      </button>
                    )}
                  </td>
                );
              })}
              <td>
                {de(jour, "midi") && de(jour, "soir") && (
                  <button type="button" className="bo-bouton bo-bouton-discret" disabled={envoi} onClick={() => fermer(jour, ["midi", "soir"])} aria-label={`Fermer la journée du ${JOURS[jour].toLowerCase()}, chaque semaine`}>
                    Fermer la journée
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ouvrir && (
        <form className="bo-semaine-ouvrir" onSubmit={valider}>
          <h3>Ouvrir le {nom(ouvrir.jour, ouvrir.service)}, chaque semaine</h3>
          <div className="ges-heures">
            {CHAMPS.map(([cle, titre]) => (
              <div className="champ" key={cle}>
                <label htmlFor={`${ids}-${cle}`}>{titre}</label>
                <input
                  id={`${ids}-${cle}`}
                  type="time"
                  required
                  value={ouvrir.heures[cle]}
                  onChange={(e) => setOuvrir({ ...ouvrir, heures: { ...ouvrir.heures, [cle]: e.target.value } })}
                />
              </div>
            ))}
          </div>
          <p className="aide">Heures reprises du même service un autre jour : à vérifier avant d&apos;ouvrir.</p>
          <div className="boutons-ligne">
            <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
              Ouvrir chaque semaine
            </button>
            <button type="button" className="bo-bouton bo-bouton-second" onClick={() => setOuvrir(null)}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
