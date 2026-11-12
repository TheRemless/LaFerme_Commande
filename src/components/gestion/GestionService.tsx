"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { jourTexte } from "@/lib/service";

type Zone = {
  numero: number;
  nom: string;
  frais_centimes: number;
  minimum_centimes: number;
  delai_min: number;
  delai_max: number;
  active: boolean;
  proposition: boolean;
  npa: { npa: string; localite: string }[];
};
type Horaire = {
  id: number;
  jour: number;
  service: "midi" | "soir";
  premiere_heure: string;
  derniere_heure: string;
  derniere_commande: string;
  derniere_commande_pizzas: string;
  proposition: boolean;
};
type Fermeture = { id: number; debut: string; fin: string; motif: string };
type Capacites = { livraison: number; retrait: number; proposition: boolean };
type Donnees = { zones: Zone[]; horaires: Horaire[]; fermetures: Fermeture[]; capacites: Capacites };

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const chf = (c: number) => (c / 100).toFixed(2);
const hm = (t: string) => t.slice(0, 5);

export function GestionService() {
  const [d, setD] = useState<Donnees | null>(null);
  const charger = useCallback(async () => {
    const rep = await fetch("/api/gestion/service", { cache: "no-store" });
    if (rep.ok) setD(await rep.json());
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);
  if (!d) return <p className="aide">Chargement…</p>;
  return (
    <div className="ges-service">
      <section className="ges-bloc">
        <h2>Zones de livraison</h2>
        <p className="aide">Enregistrer une zone la valide : elle n&apos;est plus marquée « proposition » sur le site.</p>
        <div className="ges-zones">
          {d.zones.map((z) => (
            <FicheZone key={z.numero} zone={z} recharger={charger} />
          ))}
        </div>
      </section>
      <section className="ges-bloc">
        <h2>Horaires de livraison et de retrait</h2>
        <p className="aide">Les jours absents sont fermés (dimanche et lundi). Heures de Genève.</p>
        <div className="ges-horaires">
          {d.horaires.map((h) => (
            <LigneHoraire key={h.id} h={h} recharger={charger} />
          ))}
        </div>
      </section>
      <Capacite capacites={d.capacites} recharger={charger} />
      <Fermetures fermetures={d.fermetures} recharger={charger} />
    </div>
  );
}

function FicheZone({ zone, recharger }: { zone: Zone; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({ frais: chf(zone.frais_centimes), minimum: chf(zone.minimum_centimes), delai_min: String(zone.delai_min), delai_max: String(zone.delai_max), active: zone.active });
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", {
      type: "zone",
      numero: zone.numero,
      champs: { frais: f.frais, minimum: f.minimum, delai_min: Number(f.delai_min), delai_max: Number(f.delai_max), active: f.active },
    });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  const champ = (cle: "frais" | "minimum" | "delai_min" | "delai_max") => ({
    id: `${ids}-${cle}`,
    value: f[cle],
    inputMode: "decimal" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [cle]: e.target.value }),
  });
  return (
    <form className="ges-zone" onSubmit={sauver}>
      <h3>
        {zone.nom}
        {zone.proposition && <span className="ges-badge">proposition</span>}
      </h3>
      <p className="aide">{zone.npa.map((n) => `${n.npa} ${n.localite}`).join(", ")}</p>
      <div className="details deux">
        <div className="champ">
          <label htmlFor={`${ids}-frais`}>Frais (CHF)</label>
          <input {...champ("frais")} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-minimum`}>Minimum (CHF)</label>
          <input {...champ("minimum")} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-delai_min`}>Délai annoncé, de (min)</label>
          <input {...champ("delai_min")} inputMode="numeric" />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-delai_max`}>à (min)</label>
          <input {...champ("delai_max")} inputMode="numeric" />
        </div>
      </div>
      <label className="option">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        <span>Zone ouverte à la livraison</span>
      </label>
      <button type="submit" className="bouton-second">
        Enregistrer la zone
      </button>
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
    </form>
  );
}

// Commandes au plus par créneau de 15 minutes, pour un créneau choisi par le client. 0 : sans limite.
function Capacite({ capacites, recharger }: { capacites: Capacites; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({ livraison: String(capacites.livraison), retrait: String(capacites.retrait) });
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "capacite", livraison: Number(f.livraison), retrait: Number(f.retrait) });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  return (
    <section className="ges-bloc">
      <h2>
        Commandes par créneau
        {capacites.proposition && <span className="ges-badge">proposition</span>}
      </h2>
      <p className="aide">
        Au plus, pour une même heure choisie par le client. Une commande de plus pour un créneau plein est refusée avant le paiement. Les commandes « dès que possible » ne
        comptent pas. 0 : sans limite.
      </p>
      <form className="ges-zone" onSubmit={sauver}>
        <div className="details deux">
          <div className="champ">
            <label htmlFor={`${ids}-livraison`}>Livraisons</label>
            <input id={`${ids}-livraison`} inputMode="numeric" value={f.livraison} onChange={(e) => setF({ ...f, livraison: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-retrait`}>Retraits</label>
            <input id={`${ids}-retrait`} inputMode="numeric" value={f.retrait} onChange={(e) => setF({ ...f, retrait: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="bouton-second">
          Enregistrer
        </button>
        {message && (
          <p className="aide-forte" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}

function LigneHoraire({ h, recharger }: { h: Horaire; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({
    premiere_heure: hm(h.premiere_heure),
    derniere_heure: hm(h.derniere_heure),
    derniere_commande: hm(h.derniere_commande),
    derniere_commande_pizzas: hm(h.derniere_commande_pizzas),
  });
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "horaire", id: h.id, champs: f });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  const champs: [keyof typeof f, string][] = [
    ["premiere_heure", "Première heure"],
    ["derniere_heure", "Dernière heure"],
    ["derniere_commande", "Dernière commande"],
    ["derniere_commande_pizzas", "Dernière pizza"],
  ];
  return (
    <form className="ges-horaire" onSubmit={sauver}>
      <h3>
        {JOURS[h.jour]} {h.service}
        {h.proposition && <span className="ges-badge">proposition</span>}
      </h3>
      <div className="ges-heures">
        {champs.map(([cle, titre]) => (
          <div className="champ" key={cle}>
            <label htmlFor={`${ids}-${cle}`}>{titre}</label>
            <input id={`${ids}-${cle}`} type="time" value={f[cle]} onChange={(e) => setF({ ...f, [cle]: e.target.value })} required />
          </div>
        ))}
      </div>
      <button type="submit" className="bouton-second">
        Enregistrer
      </button>
      {message && <span className="aide">{message}</span>}
    </form>
  );
}

function Fermetures({ fermetures, recharger }: { fermetures: Fermeture[]; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({ debut: "", fin: "", motif: "" });
  const [message, setMessage] = useState<string | null>(null);
  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "fermeture", ...f });
    setMessage(erreur ?? "Fermeture ajoutée.");
    if (!erreur) {
      setF({ debut: "", fin: "", motif: "" });
      await recharger();
    }
  }
  async function supprimer(id: number) {
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "fermeture-suppr", id });
    setMessage(erreur ?? "Fermeture supprimée.");
    if (!erreur) await recharger();
  }
  const jour = (d: string) => jourTexte(String(d).slice(0, 10));
  return (
    <section className="ges-bloc">
      <h2>Fermetures</h2>
      {fermetures.length === 0 ? (
        <p className="aide">Aucune fermeture prévue.</p>
      ) : (
        <ul className="ges-fermetures">
          {fermetures.map((x) => (
            <li key={x.id}>
              <span>
                Du {jour(x.debut)} au {jour(x.fin)}, {x.motif}
              </span>
              <button type="button" className="lien" onClick={() => supprimer(x.id)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="details" onSubmit={ajouter}>
        <div className="champ">
          <label htmlFor={`${ids}-debut`}>Du</label>
          <input id={`${ids}-debut`} type="date" required value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-fin`}>Au (inclus)</label>
          <input id={`${ids}-fin`} type="date" required value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} />
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-motif`}>Motif (pour vous)</label>
          <input id={`${ids}-motif`} required maxLength={120} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} />
        </div>
        <button type="submit" className="bouton-second champ-large">
          Ajouter la fermeture
        </button>
      </form>
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
