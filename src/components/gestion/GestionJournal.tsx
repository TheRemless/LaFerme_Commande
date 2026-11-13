"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { nomObjet, type FiltresJournal, type PageJournal, type Recherche } from "@/lib/journal";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";
import { annulable, quoi, resume, sansChangement, type Entree } from "./journal-lignes";
import "./journal.css";

// Journal des modifications : filtres par période, auteur, objet et recherche, page par page (vague 3, bo-pilotage).
const LIMITE = 100;
const SANS_FILTRE: Recherche = {};

export function GestionJournal() {
  const [entrees, setEntrees] = useState<Entree[] | null>(null);
  const [suivant, setSuivant] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtres, setFiltres] = useState<FiltresJournal>({ auteurs: [], objets: [] });
  const [saisie, setSaisie] = useState<Recherche>(SANS_FILTRE);
  const [actifs, setActifs] = useState<Recherche>(SANS_FILTRE);
  const [plus, setPlus] = useState(false);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Une réponse lente d'une ancienne recherche n'écrase pas la nouvelle.
  const demande = useRef(0);

  const charger = useCallback(async (r: Recherche) => {
    const n = ++demande.current;
    setErreur(null);
    const rep = await poster("/api/gestion/journal", { action: "chercher", ...r, limite: LIMITE });
    if (n !== demande.current) return;
    if (!rep.ok) {
      setErreur(String(rep.donnees.erreur ?? "Le journal ne répond pas."));
      setEntrees((e) => e ?? []);
      return;
    }
    const page = rep.donnees as unknown as PageJournal;
    setEntrees((page.entrees as Entree[]).filter((e) => !sansChangement(e)));
    setSuivant(page.suivant);
  }, []);

  useEffect(() => {
    charger(SANS_FILTRE);
    poster("/api/gestion/journal", { action: "filtres" }).then((r) => {
      if (r.ok) setFiltres(r.donnees as unknown as FiltresJournal);
    });
  }, [charger]);

  async function appliquer(r: Recherche) {
    setActifs(r);
    setEntrees(null);
    await charger(r);
  }

  async function suivantes() {
    if (suivant === null) return;
    setPlus(true);
    const n = demande.current;
    const rep = await poster("/api/gestion/journal", { action: "chercher", ...actifs, avant_id: suivant, limite: LIMITE });
    // Une nouvelle recherche lancée entre-temps : cette page ne la concerne pas.
    if (n !== demande.current) {
      setPlus(false);
      return;
    }
    if (rep.ok) {
      const page = rep.donnees as unknown as PageJournal;
      setEntrees((e) => [...(e ?? []), ...(page.entrees as Entree[]).filter((x) => !sansChangement(x))]);
      setSuivant(page.suivant);
    } else {
      setErreur(String(rep.donnees.erreur ?? "Le journal ne répond pas."));
    }
    setPlus(false);
  }

  // Retour arrière (G11) : la base refuse si la valeur a changé depuis.
  async function annuler(id: number) {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/journal", { action: "annuler", id });
    setMessage({ ok: r.ok, texte: String(r.donnees.message ?? r.donnees.erreur ?? "Pas annulé.") });
    setConfirmer(null);
    await charger(actifs);
    setEnvoi(false);
  }

  const filtre = Object.values(actifs).some(Boolean);
  const champ = (k: keyof Recherche) => (v: string) => setSaisie((s) => ({ ...s, [k]: v || undefined }));

  return (
    <section className="ges-bloc">
      <h2>Journal des modifications</h2>
      <p className="aide">Qui a changé quoi, et quand. « Annuler » remet l&apos;ancienne valeur, si rien n&apos;a changé depuis.</p>
      <form
        className="ges-filtres ges-journal-filtres"
        role="search"
        aria-label="Filtrer le journal"
        onSubmit={(ev) => {
          ev.preventDefault();
          appliquer(saisie);
        }}
      >
        <div className="champ">
          <label htmlFor="journal-recherche">Chercher</label>
          <input id="journal-recherche" type="search" maxLength={60} value={saisie.recherche ?? ""} placeholder="Plat, zone, montant, numéro…" onChange={(e) => champ("recherche")(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor="journal-objet">Quoi</label>
          <select id="journal-objet" value={saisie.objet ?? ""} onChange={(e) => champ("objet")(e.target.value)}>
            <option value="">Tout</option>
            {filtres.objets.map((o) => (
              <option key={o.objet} value={o.objet}>
                {nomObjet(o.objet)} ({o.lignes})
              </option>
            ))}
          </select>
        </div>
        <div className="champ">
          <label htmlFor="journal-auteur">Qui</label>
          <select id="journal-auteur" value={saisie.auteur ?? ""} onChange={(e) => champ("auteur")(e.target.value)}>
            <option value="">Tout le monde</option>
            {filtres.auteurs.map((a) => (
              <option key={a.nom} value={a.nom}>
                {a.nom} ({a.lignes})
              </option>
            ))}
          </select>
        </div>
        <div className="champ ges-journal-date">
          <label htmlFor="journal-debut">Du</label>
          <input id="journal-debut" type="date" value={saisie.debut ?? ""} onChange={(e) => champ("debut")(e.target.value)} />
        </div>
        <div className="champ ges-journal-date">
          <label htmlFor="journal-fin">Au</label>
          <input id="journal-fin" type="date" value={saisie.fin ?? ""} min={saisie.debut} onChange={(e) => champ("fin")(e.target.value)} />
        </div>
        <span className="boutons-ligne">
          <button type="submit" className="bouton-second">
            Filtrer
          </button>
          {filtre && (
            <button
              type="button"
              className="lien"
              onClick={() => {
                setSaisie(SANS_FILTRE);
                appliquer(SANS_FILTRE);
              }}
            >
              Tout afficher
            </button>
          )}
        </span>
      </form>
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}{" "}
          <button type="button" className="lien" onClick={() => charger(actifs)}>
            Réessayer
          </button>
        </p>
      )}
      {!entrees ? (
        <p className="aide" role="status">
          Chargement…
        </p>
      ) : entrees.length === 0 && suivant === null ? (
        !erreur && <p className="aide">{filtre ? "Aucune modification ne correspond à ces filtres." : "Aucune modification pour l'instant."}</p>
      ) : (
        <>
          <ul className="ges-plats ges-journal-liste" aria-label="Modifications, de la plus récente à la plus ancienne">
            {entrees.map((e) => (
              <li key={e.id} className={e.annule_par ? "ges-retire" : ""}>
                <p className="ges-journal-tete">
                  <strong>{quoi(e)}</strong>
                  <span>
                    {jourTexte(jourGeneveDe(e.le))}, {heureDe(e.le)}, {e.personnel_nom}
                  </span>
                </p>
                <p className="ges-diff">{resume(e)}</p>
                {e.annule_par ? (
                  <p className="aide">Annulée.</p>
                ) : (
                  annulable(e) &&
                  (confirmer === e.id ? (
                    <span className="boutons-ligne">
                      <button type="button" className="bouton-second" disabled={envoi} onClick={() => annuler(e.id)}>
                        Oui, remettre l&apos;ancienne valeur
                      </button>
                      <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                        Non
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="lien" onClick={() => setConfirmer(e.id)}>
                      Annuler
                    </button>
                  ))
                )}
              </li>
            ))}
          </ul>
          <p className="aide">
            {entrees.length} modification{entrees.length > 1 ? "s" : ""} affichée{entrees.length > 1 ? "s" : ""}.
            {suivant !== null && " "}
            {suivant !== null && (
              <button type="button" className="bouton-second" disabled={plus} onClick={suivantes}>
                {plus ? "Chargement…" : "Afficher les suivantes"}
              </button>
            )}
          </p>
        </>
      )}
    </section>
  );
}
