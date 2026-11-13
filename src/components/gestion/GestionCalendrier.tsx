"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Champ, Chargement, EtatErreur, PanneauLateral, useConfirmer, useNotifier } from "@/components/gestion/ui";
import type { JourCalendrier, ServiceJour } from "@/lib/calendrier";
import { jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { ajouterJours, jourTexte } from "@/lib/service";
import "./calendrier.css";

// Rubrique Calendrier du back-office (vague 3, bo-operations) : un mois, ce que le client voit chaque jour et ce
// qui le décide, les fériés, les commandes déjà prises ; fermer un jour ou un service depuis la fiche d'un jour.
// Données : /api/gestion/calendrier (lecture), /api/gestion/service (fermetures). Doc : docs/calendrier.md.

type ServiceAvecCommandes = ServiceJour & { commandes: { livraisons: number; retraits: number } };
type Jour = Omit<JourCalendrier, "services"> & { services: ServiceAvecCommandes[] };
type Donnees = { debut: string; fin: string; jours: Jour[]; commandes_disponibles: boolean; feries_a_confirmer: { date: string; nom: string; services: string[] }[] };

const JOURS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];
const MOIS = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" });

const premierDuMois = (d: string) => `${d.slice(0, 8)}01`;
// « 11:45 » → « 11h45 », comme sur le site et la tablette.
const h = (t?: string) => (t ?? "").replace(":", "h");
function moisSuivant(premier: string, n: number): string {
  const d = new Date(`${premier}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const dernierDuMois = (premier: string) => ajouterJours(moisSuivant(premier, 1), -1);
const commandesTexte = (s: ServiceAvecCommandes) => {
  const parts = [s.commandes.livraisons ? `${s.commandes.livraisons} liv.` : "", s.commandes.retraits ? `${s.commandes.retraits} à emp.` : ""].filter(Boolean);
  return parts.join(", ");
};

export function GestionCalendrier() {
  const aujourdHui = jourGeneveDe(new Date());
  const [mois, setMois] = useState(() => premierDuMois(aujourdHui));
  const [d, setD] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  // La dernière demande gagne : deux « Mois suivant » rapides ne doivent pas afficher le mois d'avant si sa
  // réponse arrive en dernier (même règle que useRelecture du kit).
  const charger = useCallback(
    async (signal?: AbortSignal) => {
      setErreur(null);
      try {
        const r = await fetch(`/api/gestion/calendrier?debut=${mois}&fin=${dernierDuMois(mois)}`, { cache: "no-store", signal });
        const x = await r.json();
        if (!r.ok) throw new Error(String(x.erreur ?? "Calendrier indisponible."));
        if (!signal?.aborted) setD(x);
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setErreur(e instanceof Error ? e.message : "Calendrier indisponible.");
      }
    },
    [mois],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    setD(null);
    charger(ctrl.signal);
    return () => ctrl.abort();
  }, [charger]);

  // Cases vides avant le 1er, pour que lundi reste dans la première colonne.
  const decalage = useMemo(() => (d ? (d.jours[0]?.jour ?? 1) - 1 : 0), [d]);
  const jourOuvert = d?.jours.find((j) => j.date === ouvert) ?? null;

  return (
    <div className="bo-cal">
      {d && d.feries_a_confirmer.length > 0 && (
        <FeriesAConfirmer
          feries={d.feries_a_confirmer}
          ouvrir={(date) => {
            // Un férié d'un autre mois : on y va, puis sa fiche s'ouvre quand le mois est chargé.
            if (date.slice(0, 7) !== mois.slice(0, 7)) setMois(premierDuMois(date));
            setOuvert(date);
          }}
        />
      )}

      <div className="bo-cal-tete">
        <button type="button" className="bo-bouton bo-bouton-second" onClick={() => setMois(moisSuivant(mois, -1))}>
          Mois précédent
        </button>
        <h2 aria-live="polite">{MOIS.format(new Date(`${mois}T12:00:00Z`))}</h2>
        <button type="button" className="bo-bouton bo-bouton-second" onClick={() => setMois(moisSuivant(mois, 1))}>
          Mois suivant
        </button>
      </div>

      {erreur ? (
        <EtatErreur texte={erreur} reessayer={() => charger()} />
      ) : !d ? (
        <Chargement libelle="Chargement du calendrier…" />
      ) : (
        <>
          {!d.commandes_disponibles && <p className="aide">Les commandes prises s&apos;afficheront après la mise à jour de la base.</p>}
          <ol className="bo-cal-grille" aria-label={`Jours de ${MOIS.format(new Date(`${mois}T12:00:00Z`))}`}>
            {JOURS.map((j) => (
              <li key={j} className="bo-cal-entete" aria-hidden>
                {j}
              </li>
            ))}
            {Array.from({ length: decalage }, (_, i) => (
              <li key={`vide-${i}`} className="bo-cal-vide" aria-hidden />
            ))}
            {d.jours.map((j) => (
              <li key={j.date} className={j.date === aujourdHui ? "bo-cal-jour bo-cal-aujourdhui" : j.date < aujourdHui ? "bo-cal-jour bo-cal-passe" : "bo-cal-jour"}>
                <button type="button" className="bo-cal-bouton" onClick={() => setOuvert(j.date)}>
                  {/* Le nom lu commence par la date entière ; le chiffre affiché n'est pas relu. */}
                  <span className="sr-only">{jourTexte(j.date)}, </span>
                  <span className="bo-cal-num" aria-hidden>
                    <span className="bo-cal-num-jour">{Number(j.date.slice(8))}</span>
                    <span className="bo-cal-nom-jour">{jourTexte(j.date).split(" ")[0]}</span>
                  </span>
                  {j.ferie && <span className="bo-cal-ferie">{j.ferie}</span>}
                  {j.services.map((s) => (
                    <span key={s.service} className={s.ouvert ? "bo-cal-service" : s.source === "fermeture" ? "bo-cal-service bo-cal-ferme" : "bo-cal-service bo-cal-rien"}>
                      <span className="bo-cal-service-nom">{s.service === "midi" ? "Midi" : "Soir"}</span>{" "}
                      {s.ouvert ? <span className="bo-cal-heures">{`${h(s.premiere_heure)}–${h(s.derniere_heure)}${s.source === "ouverture" ? " (exceptionnel)" : ""}`}</span> : s.source === "fermeture" ? `fermé${s.motif ? ` : ${s.motif}` : ""}` : "—"}
                      {commandesTexte(s) && <span className="bo-cal-commandes"> {commandesTexte(s)}</span>}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ol>
          <p className="aide">« liv. » : livraisons, « à emp. » : retraits déjà commandés pour ce service.</p>
        </>
      )}

      {jourOuvert && <FicheJour jour={jourOuvert} passe={jourOuvert.date < aujourdHui} fermer={() => setOuvert(null)} recharger={() => charger()} />}
    </div>
  );
}

function FeriesAConfirmer({ feries, ouvrir }: { feries: Donnees["feries_a_confirmer"]; ouvrir: (date: string) => void }) {
  return (
    <section className="bo-cal-feries" aria-labelledby="cal-feries">
      <h2 id="cal-feries">Jours fériés où vous seriez ouvert</h2>
      <p className="aide">D&apos;après vos horaires. Rien ne ferme tout seul : ouvrez le jour pour le fermer, ou laissez-le ouvert.</p>
      <ul>
        {feries.slice(0, 6).map((f) => (
          <li key={f.date}>
            <button type="button" className="bo-bouton bo-bouton-discret" onClick={() => ouvrir(f.date)}>
              {f.nom}, {jourTexte(f.date)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FicheJour({ jour, passe, fermer, recharger }: { jour: Jour; passe: boolean; fermer: () => void; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [quoi, setQuoi] = useState<"jour" | "midi" | "soir">("jour");
  const [motif, setMotif] = useState(jour.ferie ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const ouverts = jour.services.filter((s) => s.ouvert);

  async function fermerService(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (motif.trim().length < 2) return setErreur("Indiquez un motif. Les clients le lisent.");
    const touches = jour.services.filter((s) => quoi === "jour" || s.service === quoi);
    const n = touches.reduce((t, s) => t + s.commandes.livraisons + s.commandes.retraits, 0);
    const ok = await confirmer({
      titre: `Fermer ${quoi === "jour" ? "toute la journée" : `le ${quoi}`} du ${jourTexte(jour.date)} ?`,
      texte:
        n > 0
          ? `${n} commande${n > 1 ? "s sont" : " est"} déjà prise${n > 1 ? "s" : ""} pour ce moment : à annuler une par une sur la tablette, le client est remboursé et prévenu.`
          : "Aucune commande n'est prise pour ce moment. Les clients ne pourront plus le choisir.",
      oui: quoi === "jour" ? "Fermer la journée" : `Fermer le ${quoi}`,
      danger: n > 0,
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster("/api/gestion/service", { type: "fermeture", debut: jour.date, fin: jour.date, motif: motif.trim(), ...(quoi === "jour" ? {} : { service: quoi }) });
    setEnvoi(false);
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    const numeros = (r.donnees.commandes as number[] | undefined) ?? [];
    notifier({ texte: numeros.length ? `Fermé. Commandes à annuler sur la tablette : ${numeros.join(", ")}.` : "Fermé.", ton: "succes", duree: numeros.length ? 15_000 : undefined });
    await recharger();
    fermer();
  }

  return (
    <PanneauLateral titre={`${jourTexte(jour.date)}${jour.ferie ? `, ${jour.ferie}` : ""}`} onFermer={fermer}>
      <div className="bo-cal-fiche">
        <ul className="bo-cal-fiche-services">
          {jour.services.map((s) => (
            <li key={s.service}>
              <strong>{s.service === "midi" ? "Midi" : "Soir"}</strong>{" "}
              {s.ouvert
                ? `ouvert de ${h(s.premiere_heure)} à ${h(s.derniere_heure)}${s.source === "ouverture" ? ", ouverture exceptionnelle" : ""}`
                : s.source === "fermeture"
                  ? `fermé${s.motif ? ` : ${s.motif}` : ""}`
                  : "pas de service ce jour-là"}
              {s.commandes.livraisons + s.commandes.retraits > 0 && (
                <span className="bo-cal-fiche-commandes">
                  {" "}
                  {s.commandes.livraisons} livraison{s.commandes.livraisons > 1 ? "s" : ""} et {s.commandes.retraits} retrait{s.commandes.retraits > 1 ? "s" : ""} déjà commandés
                </span>
              )}
            </li>
          ))}
        </ul>
        {passe ? (
          <p className="aide">Jour passé : rien à changer.</p>
        ) : ouverts.length === 0 ? (
          <p className="aide">
            Rien d&apos;ouvert ce jour-là. Pour ouvrir exceptionnellement ou retirer une fermeture : rubrique{" "}
            <a href="/gestion/horaires#fermetures">Livraison et horaires, onglet « Fermetures »</a> (fermetures et ouvertures exceptionnelles).
          </p>
        ) : (
          <form onSubmit={fermerService} noValidate className="bo-cal-fermer">
            <h3>Fermer</h3>
            <Champ libelle="Quoi">
              {(a) => (
                <select {...a} value={quoi} onChange={(e) => setQuoi(e.target.value as typeof quoi)}>
                  <option value="jour">Toute la journée</option>
                  {ouverts.map((s) => (
                    <option key={s.service} value={s.service}>
                      Le {s.service} seulement
                    </option>
                  ))}
                </select>
              )}
            </Champ>
            <Champ libelle="Motif, lu par les clients" erreur={erreur ?? undefined}>
              {(a) => <input {...a} value={motif} maxLength={120} placeholder="Fermeture exceptionnelle" onChange={(e) => setMotif(e.target.value)} />}
            </Champ>
            <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
              {envoi ? "Fermeture…" : "Fermer"}
            </button>
          </form>
        )}
      </div>
    </PanneauLateral>
  );
}
