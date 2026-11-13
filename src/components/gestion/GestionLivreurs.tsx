"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Champ,
  Chargement,
  EtatErreur,
  EtatVide,
  Onglets,
  PanneauLateral,
  SelecteurPeriode,
  TableauDonnees,
  nombre,
  periodeDe,
  useGardeModifications,
  useNotifier,
  useRelecture,
  type Colonne,
  type Periode,
  type Tri,
} from "@/components/gestion/ui";
import { jourGeneveDe } from "@/lib/heures";
import type { JourPlanning, LivreurPlanifie, SemaineLivreur, Service, StatsLivreur } from "@/lib/planning-livreurs";
import { poster } from "@/lib/requete-client";
import { ouvertureDe, type Horaires, type Ouverture } from "@/lib/ouverture-service";
import { ajouterJours, jourTexte } from "@/lib/service";
import "./livreurs.css";

// Rubrique Livreurs du back-office (vague 3, bo-operations) : qui travaille les sept prochains jours (absence
// et renfort en un geste), la semaine type de chaque livreur, leurs livraisons sur une période.
// Données : /api/gestion/livreurs (gérant). Doc : docs/planning-livreurs.md.

type Donnees = { periode: Periode; periode_stats: Periode; semaines: SemaineLivreur[]; planning: JourPlanning[]; stats: StatsLivreur[] };
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const SERVICES: Service[] = ["midi", "soir"];
const URL = "/api/gestion/livreurs";

async function lire(stats: Periode, signal: AbortSignal): Promise<Donnees> {
  const q = new URLSearchParams({ stats_debut: stats.debut, stats_fin: stats.fin });
  const r = await fetch(`${URL}?${q}`, { cache: "no-store", signal });
  if (!r.ok) throw new Error(String(((await r.json().catch(() => ({}))) as { erreur?: string }).erreur ?? "Planning indisponible."));
  return r.json();
}

export function GestionLivreurs() {
  const aujourdHui = jourGeneveDe(new Date());
  const [onglet, setOnglet] = useState("jours");
  const [periodeStats, setPeriodeStats] = useState<Periode>(() => periodeDe("30jours", aujourdHui));
  const { donnees, erreur, recharger } = useRelecture((signal) => lire(periodeStats, signal), [periodeStats.debut, periodeStats.fin], {
    intervalleMs: 60_000,
    messageErreur: "Planning pas à jour. Vérifiez le réseau.",
  });

  // Horaires du restaurant, lus une fois : un service fermé n'a pas besoin de livreur.
  const [horaires, setHoraires] = useState<Horaires | null>(null);
  useEffect(() => {
    fetch("/api/gestion/service", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: Horaires | null) => setHoraires(h ? { horaires: h.horaires ?? [], fermetures: h.fermetures ?? [], ouvertures: h.ouvertures ?? [] } : null))
      .catch(() => setHoraires(null));
  }, []);

  if (!donnees && erreur) return <EtatErreur texte={erreur} reessayer={recharger} />;
  if (!donnees) return <Chargement libelle="Chargement du planning…" />;
  if (donnees.semaines.length === 0) {
    return (
      <EtatVide
        titre="Aucun livreur dans l'équipe."
        texte="Ajoutez-les dans la rubrique Équipe, avec l'accès « Livreur ». Ils apparaissent ici pour leur planning."
        action={
          <a className="bo-bouton bo-bouton-second" href="/gestion/equipe">
            Ouvrir l&apos;équipe
          </a>
        }
      />
    );
  }
  return (
    <div className="bo-liv">
      {erreur && (
        <p className="aide-forte" role="status">
          {erreur}
        </p>
      )}
      <Onglets
        libelle="Parties de la rubrique Livreurs"
        onglets={[
          { cle: "jours", titre: "Les 7 prochains jours" },
          { cle: "semaine", titre: "Semaine type" },
          { cle: "stats", titre: "Livraisons par livreur" },
        ]}
        actif={onglet}
        onChange={setOnglet}
      >
        {onglet === "jours" && <ProchainsJours d={donnees} horaires={horaires} aujourdHui={aujourdHui} recharger={recharger} />}
        {onglet === "semaine" && <SemainesTypes semaines={donnees.semaines} recharger={recharger} />}
        {onglet === "stats" && <Statistiques stats={donnees.stats} periode={periodeStats} onPeriode={setPeriodeStats} />}
      </Onglets>
    </div>
  );
}

// ---------- Les 7 prochains jours ----------

type Geste = { livreur: { id: string; nom: string }; jour: string; service: Service; present: boolean | null };

function ProchainsJours({ d, horaires, aujourdHui, recharger }: { d: Donnees; horaires: Horaires | null; aujourdHui: string; recharger: () => void }) {
  const notifier = useNotifier();
  const [absence, setAbsence] = useState<{ livreur: LivreurPlanifie; jour: string; service: Service } | null>(null);
  const jours = useMemo(() => Array.from({ length: 7 }, (_, i) => ajouterJours(aujourdHui, i)), [aujourdHui]);

  const envoyer = useCallback(
    async (g: Geste, motif?: string) => {
      const r = await poster(URL, { type: "jour", livreur: g.livreur.id, jour: g.jour, service: g.service, present: g.present, motif: motif || undefined });
      if (!r.ok) {
        notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
        return false;
      }
      const quand = `${jourTexte(g.jour)} ${g.service === "midi" ? "à midi" : "au soir"}`;
      notifier({
        texte: g.present === false ? `Absence notée : ${g.livreur.nom}, ${quand}.` : g.present ? `Renfort noté : ${g.livreur.nom}, ${quand}.` : `Comme d'habitude : ${g.livreur.nom}, ${quand}.`,
        ton: "succes",
      });
      recharger();
      return true;
    },
    [notifier, recharger],
  );

  return (
    <div className="bo-liv-jours">
      {jours.map((jour) => (
        <section key={jour} className="bo-liv-jour" aria-labelledby={`liv-${jour}`}>
          <h2 id={`liv-${jour}`} className="bo-liv-jour-titre">
            {jour === aujourdHui ? "Aujourd'hui, " : ""}
            {jourTexte(jour)}
          </h2>
          <div className="bo-liv-services">
            {SERVICES.map((service) => (
              <ServiceDuJour
                key={service}
                jour={jour}
                service={service}
                entree={d.planning.find((p) => p.jour === jour && p.service === service)}
                ouverture={ouvertureDe(horaires, jour, service)}
                tous={d.semaines}
                envoyer={envoyer}
                demanderAbsence={(livreur) => setAbsence({ livreur, jour, service })}
              />
            ))}
          </div>
        </section>
      ))}
      {absence && <PanneauAbsence absence={absence} fermer={() => setAbsence(null)} envoyer={envoyer} />}
    </div>
  );
}

function ServiceDuJour({
  jour,
  service,
  entree,
  ouverture,
  tous,
  envoyer,
  demanderAbsence,
}: {
  jour: string;
  service: Service;
  entree: JourPlanning | undefined;
  ouverture: Ouverture | null;
  tous: SemaineLivreur[];
  envoyer: (g: Geste) => Promise<boolean>;
  demanderAbsence: (l: LivreurPlanifie) => void;
}) {
  const [ajout, setAjout] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  const livreurs = entree?.livreurs ?? [];
  const presents = entree?.presents ?? 0;
  const libres = tous.filter((l) => !livreurs.some((x) => x.id === l.id && x.present));
  const titre = service === "midi" ? "Midi" : "Soir";

  async function geste(g: Geste) {
    setEnCours(g.livreur.id);
    await envoyer(g);
    setEnCours(null);
  }

  const ferme = ouverture?.ouvert === false;
  if (ferme && livreurs.length === 0) {
    return (
      <div className="bo-liv-service bo-liv-ferme">
        <h3>{titre}</h3>
        <p className="aide">Fermé{ouverture.motif ? ` : ${ouverture.motif}` : ""}</p>
      </div>
    );
  }
  return (
    <div className="bo-liv-service">
      <div className="bo-liv-service-tete">
        <h3>{titre}</h3>
        {/* Le nombre de présents, en grand : c'est ce qu'on lit en premier un soir de service. */}
        <p className="bo-liv-compte" aria-label={`${presents} livreur${presents > 1 ? "s" : ""} prévu${presents > 1 ? "s" : ""}`}>
          <strong>{presents}</strong> {presents > 1 ? "livreurs" : "livreur"}
        </p>
      </div>
      {ferme && <p className="aide">Fermé{ouverture.motif ? ` : ${ouverture.motif}` : ""}. Ces livreurs n&apos;ont rien à livrer.</p>}
      {!ferme && presents === 0 && (
        // Service ouvert sans livreur : la livraison ne tiendra pas. Écrit en toutes lettres, pas en couleur.
        <p className="bo-liv-manque">{livreurs.length === 0 ? "Personne de prévu pour livrer." : "Plus personne pour livrer."}</p>
      )}
      {livreurs.length === 0 ? null : (
        <ul className="bo-liv-liste">
          {livreurs.map((l) => (
            <li key={l.id} className={l.present ? "bo-liv-ligne" : "bo-liv-ligne bo-liv-absent"}>
              <span className="bo-liv-nom">
                <span className="bo-liv-prenom">{l.nom}</span>
                <span className="bo-liv-etat">{l.source === "absent" ? `absence${l.motif ? ` : ${l.motif}` : ""}` : l.source === "ajout" ? "en renfort" : "semaine type"}</span>
              </span>
              {l.source === "semaine" && (
                <button type="button" className="bo-bouton bo-bouton-second" disabled={enCours === l.id} onClick={() => demanderAbsence(l)}>
                  Absent
                </button>
              )}
              {l.source === "absent" && (
                <button
                  type="button"
                  className="bo-bouton bo-bouton-second"
                  disabled={enCours === l.id}
                  onClick={() => geste({ livreur: l, jour, service, present: null })}
                >
                  Comme d&apos;habitude
                </button>
              )}
              {l.source === "ajout" && (
                <button
                  type="button"
                  className="bo-bouton bo-bouton-discret"
                  disabled={enCours === l.id}
                  onClick={() => geste({ livreur: l, jour, service, present: null })}
                >
                  Retirer le renfort
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {libres.length > 0 && (
        <form
          className="bo-liv-ajout"
          onSubmit={async (e) => {
            e.preventDefault();
            const l = tous.find((x) => x.id === ajout);
            if (!l) return;
            await geste({ livreur: l, jour, service, present: true });
            setAjout("");
          }}
        >
          <label className="sr-only" htmlFor={`ajout-${jour}-${service}`}>
            Ajouter un livreur {titre.toLowerCase()} {jourTexte(jour)}
          </label>
          <select id={`ajout-${jour}-${service}`} value={ajout} onChange={(e) => setAjout(e.target.value)}>
            <option value="">Ajouter un livreur…</option>
            {libres.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom}
              </option>
            ))}
          </select>
          <button type="submit" className="bo-bouton bo-bouton-second" disabled={!ajout || enCours !== null}>
            Ajouter
          </button>
        </form>
      )}
    </div>
  );
}

function PanneauAbsence({
  absence,
  fermer,
  envoyer,
}: {
  absence: { livreur: LivreurPlanifie; jour: string; service: Service };
  fermer: () => void;
  envoyer: (g: Geste, motif?: string) => Promise<boolean>;
}) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const quand = `${jourTexte(absence.jour)}, ${absence.service === "midi" ? "midi" : "soir"}`;
  return (
    <PanneauLateral
      titre={`Absence de ${absence.livreur.nom}`}
      onFermer={fermer}
      pied={
        <>
          <button type="button" className="bo-bouton bo-bouton-discret" onClick={fermer}>
            Annuler
          </button>
          <button
            type="submit"
            form="liv-absence"
            className="bo-bouton bo-bouton-principal"
            disabled={envoi}
          >
            Noter l&apos;absence
          </button>
        </>
      }
    >
      <form
        id="liv-absence"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnvoi(true);
          const ok = await envoyer({ livreur: absence.livreur, jour: absence.jour, service: absence.service, present: false }, motif.trim());
          setEnvoi(false);
          if (ok) fermer();
        }}
      >
        <p>{quand}. Ne compte plus dans les livreurs de ce service. La semaine type ne change pas.</p>
        <Champ libelle="Motif" aide="Pour l'équipe seulement : jamais montré aux clients." facultatif>
          {(a) => <input {...a} value={motif} maxLength={120} onChange={(e) => setMotif(e.target.value)} placeholder="Malade, congé…" />}
        </Champ>
      </form>
    </PanneauLateral>
  );
}

// ---------- Semaine type ----------

const cle = (jour: number, service: Service) => `${jour}-${service}`;

function SemainesTypes({ semaines, recharger }: { semaines: SemaineLivreur[]; recharger: () => void }) {
  return (
    <div className="bo-liv-semaines">
      <p className="aide">Les services où chacun travaille d&apos;habitude. Une absence ou un renfort d&apos;un jour se note dans « Les 7 prochains jours ».</p>
      <div className="bo-liv-grille-cadre">
        <table className="bo-liv-grille">
          <caption className="sr-only">Semaine type des livreurs</caption>
          <thead>
            <tr>
              <th scope="col">Livreur</th>
              {JOURS.map((j) => (
                <th key={j} scope="col" abbr={j}>
                  {j.slice(0, 3)}.
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Enregistrer</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {semaines.map((s) => (
              <LigneSemaine key={s.id} semaine={s} recharger={recharger} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LigneSemaine({ semaine, recharger }: { semaine: SemaineLivreur; recharger: () => void }) {
  const notifier = useNotifier();
  const initial = useMemo(() => new Set(semaine.creneaux.map((c) => cle(c.jour, c.service))), [semaine.creneaux]);
  const [choix, setChoix] = useState<Set<string>>(initial);
  const [envoi, setEnvoi] = useState(false);
  const modifie = choix.size !== initial.size || [...choix].some((k) => !initial.has(k));
  useGardeModifications(modifie);

  function basculer(k: string) {
    setChoix((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  async function enregistrer() {
    setEnvoi(true);
    const creneaux = [...choix].map((k) => ({ jour: Number(k.split("-")[0]), service: k.split("-")[1] as Service }));
    const r = await poster(URL, { type: "semaine", livreur: semaine.id, creneaux });
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: `Semaine de ${semaine.nom} enregistrée.`, ton: "succes" });
    recharger();
  }

  return (
    <tr>
      <th scope="row" className="bo-liv-grille-nom">
        {semaine.nom}
      </th>
      {JOURS.map((nomJour, i) => (
        <td key={nomJour}>
          <div className="bo-liv-cases">
            {SERVICES.map((service) => {
              const k = cle(i + 1, service);
              const actif = choix.has(k);
              return (
                <button
                  key={service}
                  type="button"
                  className={actif ? "bo-liv-case bo-liv-case-oui" : "bo-liv-case"}
                  aria-pressed={actif}
                  aria-label={`${semaine.nom}, ${nomJour.toLowerCase()} ${service}`}
                  onClick={() => basculer(k)}
                >
                  {service === "midi" ? "Midi" : "Soir"}
                </button>
              );
            })}
          </div>
        </td>
      ))}
      <td>
        <button type="button" className="bo-bouton bo-bouton-principal" disabled={!modifie || envoi} onClick={enregistrer}>
          {envoi ? "Enregistrement…" : "Enregistrer"}
        </button>
      </td>
    </tr>
  );
}

// ---------- Livraisons par livreur ----------

const minutes = (v: number | null) => (v === null ? "—" : `${nombre(v)} min`);

const COLONNES: Colonne<StatsLivreur>[] = [
  { cle: "nom", titre: "Livreur", valeur: (s) => (s.actif ? s.nom : `${s.nom} (retiré)`), triable: true, fixe: true },
  { cle: "livraisons", titre: "Attribuées", valeur: (s) => s.livraisons, triable: true, nombre: true },
  { cle: "livrees", titre: "Livrées", valeur: (s) => s.livrees, triable: true, nombre: true },
  { cle: "client_absent", titre: "Client absent", valeur: (s) => s.client_absent, triable: true, nombre: true },
  { cle: "problemes", titre: "Problèmes signalés", valeur: (s) => s.problemes, triable: true, nombre: true },
  { cle: "minutes_moyennes", titre: "Temps moyen sur la route", valeur: (s) => minutes(s.minutes_moyennes), triable: true, nombre: true },
  { cle: "retard_moyen_minutes", titre: "Retard moyen", valeur: (s) => minutes(s.retard_moyen_minutes), triable: true, nombre: true },
];

function Statistiques({ stats, periode, onPeriode }: { stats: StatsLivreur[]; periode: Periode; onPeriode: (p: Periode) => void }) {
  const [tri, setTri] = useState<Tri>({ cle: "livraisons", sens: "desc" });
  // Une ligne par livreur (une dizaine au plus) : le tri se fait ici.
  const lignes = useMemo(() => {
    const v = (s: StatsLivreur) => s[tri.cle as keyof StatsLivreur] ?? -1;
    return [...stats].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * (tri.sens === "asc" ? 1 : -1));
  }, [stats, tri]);
  return (
    <div className="bo-liv-stats">
      <TableauDonnees<StatsLivreur>
        titre="Livraisons par livreur"
        colonnes={COLONNES}
        lignes={lignes}
        cleLigne={(s) => s.livreur_id}
        tri={tri}
        onTri={setTri}
        filtres={<SelecteurPeriode valeur={periode} onChange={onPeriode} maxJours={93} libelle="Période" />}
        vide={{ titre: "Aucune livraison sur cette période.", texte: "Choisissez une autre période." }}
        memoire="livreurs-stats"
      />
      <p className="aide">
        Temps sur la route : de « Je pars » à « Livrée ». Retard : après l&apos;heure promise au client. Les livraisons données à un autre livreur ne comptent que pour lui.
      </p>
    </div>
  );
}
