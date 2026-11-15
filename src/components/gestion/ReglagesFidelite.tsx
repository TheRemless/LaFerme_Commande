"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { jourCourt } from "@/components/gestion/commandes/libelles";
import { BarreEnregistrer, Champ, Chargement, EtatErreur, montant, useFormulaire, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Réglages de la cagnotte (vague 3, client-compte), sous les Réglages généraux : taux, seuil d'utilisation, soirs
// doublés, et le montant dû aux clients (solde de toutes les cagnottes) pour la fiduciaire. L'interrupteur général
// est dans les Réglages généraux, avec les autres.

type Reglages = {
  active: boolean;
  taux_pourcent: number;
  seuil_centimes: number;
  soirs_doubles: { jours: number[]; dates: string[] };
  du_centimes: number;
  comptes: number;
  calcule_le: string;
};

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function ReglagesFidelite() {
  const [r, setR] = useState<Reglages | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async () => {
    try {
      const rep = await fetch("/api/gestion/fidelite", { cache: "no-store" });
      const d = await rep.json();
      if (!rep.ok) throw new Error(String(d.erreur ?? "Réglages de la cagnotte indisponibles."));
      setR(d as Reglages);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Réglages de la cagnotte indisponibles.");
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!r) return <Chargement libelle="Chargement de la cagnotte…" />;
  return <Formulaire r={r} recharger={charger} />;
}

function Formulaire({ r, recharger }: { r: Reglages; recharger: () => Promise<void> }) {
  const ids = useId();
  const notifier = useNotifier();
  const [date, setDate] = useState("");
  const f = useFormulaire(
    { taux: String(r.taux_pourcent), seuil: (r.seuil_centimes / 100).toFixed(2), jours: r.soirs_doubles.jours, dates: r.soirs_doubles.dates },
    {
      valider: (v) => {
        const e: Record<string, string> = {};
        const t = Number(v.taux);
        const s = Number(v.seuil.replace(",", "."));
        if (!Number.isInteger(t) || t < 3 || t > 10) e.taux = "Un taux de 3 à 10 %.";
        if (!Number.isFinite(s) || s < 0 || s > 50) e.seuil = "De CHF 0 à CHF 50.";
        return e;
      },
      enregistrer: (v) =>
        poster("/api/gestion/fidelite", {
          taux_pourcent: Number(v.taux),
          seuil_centimes: Math.round(Number(v.seuil.replace(",", ".")) * 100),
          soirs_doubles: { jours: v.jours, dates: v.dates },
        }),
      apres: async () => {
        notifier({ texte: "Cagnotte enregistrée.", ton: "succes" });
        await recharger();
      },
    },
  );
  const v = f.valeurs;
  const basculerJour = (j: number) => f.changer("jours", v.jours.includes(j) ? v.jours.filter((x) => x !== j) : [...v.jours, j].sort());
  const ajouterDate = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !v.dates.includes(date)) f.changer("dates", [...v.dates, date].sort());
    setDate("");
  };

  return (
    <form onSubmit={f.soumettre} noValidate className="bo-reglages-fidelite">
      <fieldset className="bo-reg-groupe">
        <legend>Cagnotte</legend>
        <p className="bo-champ-aide">
          {r.active ? "Allumée." : "Éteinte : les clients ne gagnent ni n'utilisent rien. L'interrupteur est plus haut, avec les autres."}
        </p>
        <DuAuxClients r={r} />
        <Champ libelle="Taux sur le prix des plats (%)" aide="De 3 à 10 %. Doublé les soirs choisis plus bas." erreur={f.erreurs.taux}>
          {(a) => <input {...a} inputMode="numeric" value={v.taux} onChange={(e) => f.changer("taux", e.target.value)} />}
        </Champ>
        <Champ libelle="Utilisable dès (CHF)" aide="Le client déduit sa cagnotte au paiement en ligne à partir de ce solde." erreur={f.erreurs.seuil}>
          {(a) => <input {...a} inputMode="decimal" value={v.seuil} onChange={(e) => f.changer("seuil", e.target.value)} />}
        </Champ>
        <fieldset className="bo-reg-groupe">
          <legend>Soirs doublés, chaque semaine</legend>
          <p className="bo-champ-aide">Pour une commande promise dès 15h ces jours-là.</p>
          {JOURS.map((nom, i) => (
            <label key={nom} className="bo-case">
              <input type="checkbox" checked={v.jours.includes(i + 1)} onChange={() => basculerJour(i + 1)} />
              {nom}
            </label>
          ))}
        </fieldset>
        <fieldset className="bo-reg-groupe">
          <legend>Soirs doublés, à une date</legend>
          {v.dates.length > 0 ? (
            <ul className="bo-fiche-liste">
              {v.dates.map((d) => (
                <li key={d}>
                  {jourCourt(d)}{" "}
                  <button type="button" className="bo-bouton bo-bouton-discret bo-bouton-petit" onClick={() => f.changer("dates", v.dates.filter((x) => x !== d))}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bo-champ-aide">Aucune date.</p>
          )}
          <label htmlFor={`${ids}-date`}>Ajouter une date</label>
          <input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="bo-bouton bo-bouton-petit" onClick={ajouterDate}>
            Ajouter
          </button>
        </fieldset>
      </fieldset>
      <BarreEnregistrer etat={f.etat} message={f.message} modifie={f.modifie} reinitialiser={f.reinitialiser} libelle="Mettre à jour la cagnotte" />
    </form>
  );
}

// Montant dû aux clients (solde de toutes les cagnottes) : maintenant, avec l'heure du chiffre, et à la fin d'un jour
// choisi pour le bilan de la fiduciaire (31.12).
function DuAuxClients({ r }: { r: Reglages }) {
  const ids = useId();
  const [jour, setJour] = useState("");
  const [resultat, setResultat] = useState<{ au: string; du_centimes: number; comptes: number } | string | null>(null);
  const heure = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(r.calcule_le));
  async function calculer() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return;
    const rep = await fetch(`/api/gestion/fidelite?au=${jour}`, { cache: "no-store" });
    const d = await rep.json().catch(() => ({}));
    setResultat(rep.ok ? (d as { au: string; du_centimes: number; comptes: number }) : String(d.erreur ?? "Calcul impossible."));
  }
  return (
    <div className="bo-reg-du">
      <p>
        Montant dû aux clients : <strong>CHF {montant(r.du_centimes)}</strong> sur {r.comptes} compte{r.comptes > 1 ? "s" : ""}, le {heure}.
      </p>
      <label htmlFor={`${ids}-au`}>Montant dû à la fin du jour</label>
      <input id={`${ids}-au`} type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
      <button type="button" className="bo-bouton bo-bouton-petit" onClick={() => void calculer()}>
        Calculer
      </button>
      {typeof resultat === "string" ? (
        <p className="bo-champ-aide" role="alert">
          {resultat}
        </p>
      ) : resultat ? (
        <p role="status">
          À la fin du {new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${resultat.au}T12:00:00Z`))} : <strong>CHF {montant(resultat.du_centimes)}</strong> sur {resultat.comptes} compte{resultat.comptes > 1 ? "s" : ""}.
        </p>
      ) : null}
    </div>
  );
}
