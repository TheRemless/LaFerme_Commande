"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { poster } from "@/lib/requete-client";
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
type Fermeture = { id: number; debut: string; fin: string; motif: string; service?: "midi" | "soir" | null };
type Ouverture = { id: number; jour: string; service: "midi" | "soir"; premiere_heure: string; derniere_heure: string; motif: string };
type Capacites = { livraison: number; retrait: number; proposition: boolean };
type Donnees = {
  zones: Zone[];
  horaires: Horaire[];
  fermetures: Fermeture[];
  ouvertures: Ouverture[];
  capacites: Capacites;
  preparation: number;
  plafond_comptoir_centimes: number | null;
  impressionAvance: { livraison: number; retrait: number; proposition: boolean } | null;
};

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
            <FicheZone key={z.numero} zone={z} zones={d.zones} recharger={charger} />
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
      <Preparation minutes={d.preparation} recharger={charger} />
      <Capacite capacites={d.capacites} recharger={charger} />
      <Plafond centimes={d.plafond_comptoir_centimes} recharger={charger} />
      {d.impressionAvance && <ImpressionAvance reglage={d.impressionAvance} recharger={charger} />}
      <Fermetures fermetures={d.fermetures} recharger={charger} />
      <Ouvertures ouvertures={d.ouvertures ?? []} recharger={charger} />
    </div>
  );
}

function FicheZone({ zone, zones, recharger }: { zone: Zone; zones: Zone[]; recharger: () => Promise<void> }) {
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
      <Communes zone={zone} zones={zones} recharger={recharger} />
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

// Délai habituel entre la commande et le retrait (audit du gérant, G05). Le retard d'un soir chargé se
// règle sur la tablette et revient à zéro chaque nuit.
function Preparation({ minutes, recharger }: { minutes: number; recharger: () => Promise<void> }) {
  const ids = useId();
  const [v, setV] = useState(String(minutes));
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "preparation", minutes: Number(v) });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  return (
    <section className="ges-bloc">
      <h2>Délai de préparation habituel</h2>
      <p className="aide">
        Temps entre la commande et le retrait au comptoir, pour l&apos;heure « dès que possible ». La livraison utilise les délais des zones. Un soir chargé, le
        retard se règle sur la tablette.
      </p>
      <form className="ges-retraits" onSubmit={sauver}>
        <div className="champ">
          <label htmlFor={`${ids}-prep`}>Minutes</label>
          <input id={`${ids}-prep`} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} />
        </div>
        <button type="submit" className="bouton-second">
          Enregistrer
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

// Tickets d'une commande acceptée pour plus tard : ce nombre de minutes avant l'heure promise (SS-11, G08).
function ImpressionAvance({ reglage, recharger }: { reglage: { livraison: number; retrait: number; proposition: boolean }; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({ livraison: String(reglage.livraison), retrait: String(reglage.retrait) });
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "impression_avance", livraison: Number(f.livraison), retrait: Number(f.retrait) });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  return (
    <section className="ges-bloc">
      <h2>
        Tickets des commandes à l&apos;avance
        {reglage.proposition && <span className="ges-badge">proposition</span>}
      </h2>
      <p className="aide">
        Une commande acceptée pour ce soir ou un autre jour reste dans « À l&apos;avance » sur la tablette. Ses tickets sortent ce nombre de minutes avant l&apos;heure
        annoncée au client. De 15 à 240.
      </p>
      <form className="ges-zone" onSubmit={sauver}>
        <div className="details deux">
          <div className="champ">
            <label htmlFor={`${ids}-livraison`}>Livraison, minutes avant</label>
            <input id={`${ids}-livraison`} inputMode="numeric" value={f.livraison} onChange={(e) => setF({ ...f, livraison: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-retrait`}>Retrait, minutes avant</label>
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
  // Journée entière (Du, Au) ou un seul service d'un jour (audit du gérant, vague 2).
  const [f, setF] = useState({ debut: "", fin: "", motif: "", service: "" as "" | "midi" | "soir" });
  const [message, setMessage] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const r = await poster("/api/gestion/service", { type: "fermeture", debut: f.debut, fin: f.service ? f.debut : f.fin, motif: f.motif, service: f.service || null });
    if (!r.ok) return setMessage(String(r.donnees.erreur ?? "Pas enregistré."));
    // Commandes déjà prises sur la période : à annuler sur la tablette (G15).
    const prises = Array.isArray(r.donnees.commandes) ? (r.donnees.commandes as number[]) : [];
    setMessage(
      prises.length
        ? `Fermeture ajoutée. Attention : ${prises.length === 1 ? "la commande" : "les commandes"} ${prises.join(", ")} ${prises.length === 1 ? "est déjà prise" : "sont déjà prises"} pour ce moment. Annulez-les sur la tablette, onglet « À l'avance ».`
        : "Fermeture ajoutée.",
    );
    setF({ debut: "", fin: "", motif: "", service: "" });
    await recharger();
  }
  async function supprimer(id: number) {
    setMessage(null);
    setConfirmer(null);
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
                {x.service ? `Le ${jour(x.debut)}, ${x.service === "midi" ? "le midi" : "le soir"}` : `Du ${jour(x.debut)} au ${jour(x.fin)}`}, {x.motif}
              </span>
              {confirmer === x.id ? (
                <span className="boutons-ligne">
                  <button type="button" className="bouton-second" onClick={() => supprimer(x.id)}>
                    Oui, rouvrir
                  </button>
                  <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                    Garder
                  </button>
                </span>
              ) : (
                <button type="button" className="lien" onClick={() => setConfirmer(x.id)}>
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="details" onSubmit={ajouter}>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-service`}>Fermer</label>
          <select id={`${ids}-service`} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as "" | "midi" | "soir" })}>
            <option value="">Des journées entières</option>
            <option value="midi">Un midi</option>
            <option value="soir">Un soir</option>
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-debut`}>{f.service ? "Le" : "Du"}</label>
          <input id={`${ids}-debut`} type="date" required value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} />
        </div>
        {!f.service && (
          <div className="champ">
            <label htmlFor={`${ids}-fin`}>Au (inclus)</label>
            <input id={`${ids}-fin`} type="date" required value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} />
          </div>
        )}
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

// Ouvrir un jour normalement fermé, ou un service avec d'autres heures ce jour-là (audit du gérant, vague 2).
function Ouvertures({ ouvertures, recharger }: { ouvertures: Ouverture[]; recharger: () => Promise<void> }) {
  const ids = useId();
  const vide = { jour: "", service: "soir" as "midi" | "soir", premiere_heure: "18:45", derniere_heure: "22:45", derniere_commande: "21:30", derniere_commande_pizzas: "22:15", motif: "" };
  const [f, setF] = useState(vide);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const { jour, service, motif, ...champs } = f;
    const erreur = await enregistrer("/api/gestion/service", { type: "ouverture", jour, service, motif, champs });
    setMessage(erreur ?? "Ouverture ajoutée. Les clients peuvent choisir ce moment tout de suite.");
    if (!erreur) {
      setF(vide);
      await recharger();
    }
  }
  async function supprimer(id: number) {
    setMessage(null);
    setConfirmer(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "ouverture-suppr", id });
    setMessage(erreur ?? "Ouverture supprimée.");
    if (!erreur) await recharger();
  }
  const heures: [keyof typeof f, string][] = [
    ["premiere_heure", "Première heure"],
    ["derniere_heure", "Dernière heure"],
    ["derniere_commande", "Dernière commande"],
    ["derniere_commande_pizzas", "Dernière pizza"],
  ];
  return (
    <section className="ges-bloc">
      <h2>Ouvertures exceptionnelles</h2>
      <p className="aide">Un jour normalement fermé (dimanche, lundi), ou d&apos;autres heures pour un service ce jour-là.</p>
      {ouvertures.length > 0 && (
        <ul className="ges-fermetures">
          {ouvertures.map((x) => (
            <li key={x.id}>
              <span>
                Le {jourTexte(String(x.jour).slice(0, 10))}, {x.service === "midi" ? "le midi" : "le soir"}, de {hm(x.premiere_heure)} à {hm(x.derniere_heure)}, {x.motif}
              </span>
              {confirmer === x.id ? (
                <span className="boutons-ligne">
                  <button type="button" className="bouton-second" onClick={() => supprimer(x.id)}>
                    Oui, supprimer
                  </button>
                  <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                    Garder
                  </button>
                </span>
              ) : (
                <button type="button" className="lien" onClick={() => setConfirmer(x.id)}>
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="details" onSubmit={ajouter}>
        <div className="champ">
          <label htmlFor={`${ids}-jour`}>Le</label>
          <input id={`${ids}-jour`} type="date" required value={f.jour} onChange={(e) => setF({ ...f, jour: e.target.value })} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-service`}>Service</label>
          <select id={`${ids}-service`} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as "midi" | "soir" })}>
            <option value="midi">Midi</option>
            <option value="soir">Soir</option>
          </select>
        </div>
        {heures.map(([cle, titre]) => (
          <div className="champ" key={cle}>
            <label htmlFor={`${ids}-${cle}`}>{titre}</label>
            <input id={`${ids}-${cle}`} type="time" required value={f[cle]} onChange={(e) => setF({ ...f, [cle]: e.target.value })} />
          </div>
        ))}
        <div className="champ champ-large">
          <label htmlFor={`${ids}-motif`}>Motif (pour vous)</label>
          <input id={`${ids}-motif`} required maxLength={120} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} />
        </div>
        <button type="submit" className="bouton-second champ-large">
          Ajouter l&apos;ouverture
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

// Communes d'une zone : la zone d'une adresse vient toujours de l'adresse officielle du registre fédéral.
function Communes({ zone, zones, recharger }: { zone: Zone; zones: Zone[]; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({ npa: "", localite: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [retirer, setRetirer] = useState<string | null>(null);
  async function envoyer(corps: Record<string, unknown>, ok: string) {
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "npa", ...corps });
    setMessage(erreur ?? ok);
    setRetirer(null);
    if (!erreur) await recharger();
    return !erreur;
  }
  return (
    <div className="ges-communes">
      <ul className="ges-fermetures">
        {zone.npa.map((n) => {
          const k = `${n.npa} ${n.localite}`;
          return (
            <li key={k}>
              <span>{k}</span>
              {retirer === k ? (
                <span className="boutons-ligne">
                  <button type="button" className="bouton-second" onClick={() => envoyer({ npa: n.npa, localite: n.localite, retirer: true }, `${k} retiré.`)}>
                    Oui, retirer
                  </button>
                  <button type="button" className="lien" onClick={() => setRetirer(null)}>
                    Garder
                  </button>
                </span>
              ) : (
                <button type="button" className="lien" onClick={() => setRetirer(k)}>
                  Retirer
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="details deux">
        <div className="champ">
          <label htmlFor={`${ids}-npa`}>NPA</label>
          <input id={`${ids}-npa`} inputMode="numeric" maxLength={4} value={f.npa} onChange={(e) => setF({ ...f, npa: e.target.value })} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-localite`}>Localité</label>
          <input id={`${ids}-localite`} maxLength={60} value={f.localite} onChange={(e) => setF({ ...f, localite: e.target.value })} />
        </div>
      </div>
      <p className="aide">
        Écrivez la localité comme sur l&apos;adresse officielle (ex. Petit-Lancy). Une commune déjà dans une autre zone y est déplacée.
      </p>
      <button
        type="button"
        className="bouton-second"
        onClick={async () => {
          if (await envoyer({ npa: f.npa.trim(), localite: f.localite.trim(), zone: zone.numero }, `${f.npa} ${f.localite} ajouté à la ${zone.nom}.`)) setF({ npa: "", localite: "" });
        }}
      >
        Ajouter à la {zone.nom}
      </button>
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

// Plafond du paiement au comptoir (décision de Jérémy : 100 CHF au départ). Au-delà, paiement en ligne seulement.
function Plafond({ centimes, recharger }: { centimes: number | null; recharger: () => Promise<void> }) {
  const ids = useId();
  const [v, setV] = useState(centimes === null ? "" : (centimes / 100).toFixed(0));
  const [message, setMessage] = useState<string | null>(null);
  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/service", { type: "plafond", francs: v.trim() });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }
  return (
    <section className="ges-bloc">
      <h2>Paiement au comptoir</h2>
      <p className="aide">
        Montant le plus haut qu&apos;un client peut payer au comptoir, à emporter. Au-delà, il paie en ligne. 0 : pas de paiement au comptoir.
      </p>
      <form className="ges-retraits" onSubmit={sauver}>
        <div className="champ">
          <label htmlFor={`${ids}-plafond`}>Jusqu&apos;à (CHF)</label>
          <input id={`${ids}-plafond`} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
        </div>
        <button type="submit" className="bouton-second">
          Enregistrer
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
