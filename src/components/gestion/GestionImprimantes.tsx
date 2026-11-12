"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { heureDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";

type Imprimante = { id: number; nom: string; station: "pizza" | "cuisine"; actif: boolean; liee: boolean; vue_le: string | null; en_ligne: boolean; statut_code: string | null };

export function GestionImprimantes() {
  const ids = useId();
  const [d, setD] = useState<{ imprimantes: Imprimante[]; alerte_minutes: number } | null>(null);
  const [nouvelle, setNouvelle] = useState({ nom: "", station: "pizza" as "pizza" | "cuisine" });
  const [url, setUrl] = useState<string | null>(null);
  const [alerte, setAlerte] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Confirmation avant un geste qui arrête une imprimante (audit du gérant, G10).
  const [confirmer, setConfirmer] = useState<{ id: number; geste: "jeton" | "actif" } | null>(null);

  const charger = useCallback(async () => {
    const rep = await fetch("/api/gestion/imprimantes", { cache: "no-store" });
    if (rep.ok) {
      const r = await rep.json();
      setD(r);
      setAlerte(String(r.alerte_minutes));
    }
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function demanderUrl(corps: Record<string, unknown>) {
    setMessage(null);
    setUrl(null);
    const r = await poster("/api/gestion/imprimantes", corps);
    if (!r.ok) return setMessage(String(r.donnees.erreur ?? "Pas enregistré."));
    setUrl(String(r.donnees.url));
    await charger();
  }

  async function action(corps: Record<string, unknown>, ok: string) {
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/imprimantes", corps);
    setMessage(erreur ?? ok);
    if (!erreur) await charger();
  }

  if (!d) return <p className="aide">Chargement…</p>;
  return (
    <div className="ges-service">
      <section className="ges-bloc">
        <h2>Imprimantes</h2>
        <p>
          Chaque imprimante a sa propre adresse, à coller dans ses réglages CloudPRNT. L&apos;adresse contient un code secret : elle ne s&apos;affiche
          qu&apos;une fois. En cas de doute, générez-en une nouvelle, l&apos;ancienne ne marche plus.
        </p>
        {url && (
          <div className="ges-url" role="status">
            <p className="aide-forte">Adresse CloudPRNT, à copier maintenant :</p>
            <code>{url}</code>
            <button type="button" className="bouton-second" onClick={() => navigator.clipboard?.writeText(url)}>
              Copier
            </button>
          </div>
        )}
        {d.imprimantes.length === 0 ? (
          <p className="aide">Aucune imprimante. Sans imprimante, les tickets s&apos;affichent en grand sur la tablette.</p>
        ) : (
          <ul className="ges-fermetures">
            {d.imprimantes.map((i) => (
              <li key={i.id}>
                <span>
                  <strong>{i.nom}</strong>, poste {i.station}.{" "}
                  {!i.actif ? "Désactivée." : i.en_ligne ? "En ligne." : i.vue_le ? `Hors ligne depuis ${heureDe(i.vue_le)}.` : "Jamais connectée."}
                  {i.liee ? "" : " Pas encore liée à un appareil."}
                </span>
                {confirmer?.id === i.id ? (
                  <span className="ges-confirmer" role="alert">
                    <span>
                      {confirmer.geste === "jeton"
                        ? `${i.nom} n'imprimera plus tant que la nouvelle adresse n'est pas collée dans ses réglages.`
                        : `${i.nom} n'imprimera plus. Ses tickets s'afficheront sur la tablette.`}
                    </span>
                    <span className="boutons-ligne">
                      <button
                        type="button"
                        className="bouton-second"
                        onClick={() => {
                          setConfirmer(null);
                          if (confirmer.geste === "jeton") demanderUrl({ type: "jeton", id: i.id });
                          else action({ type: "actif", id: i.id, actif: false }, "Désactivée.");
                        }}
                      >
                        {confirmer.geste === "jeton" ? "Oui, nouvelle adresse" : "Oui, désactiver"}
                      </button>
                      <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                        Garder
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="boutons-ligne">
                    <button type="button" className="lien" onClick={() => setConfirmer({ id: i.id, geste: "jeton" })}>
                      Nouvelle adresse
                    </button>
                    <button
                      type="button"
                      className="lien"
                      onClick={() => (i.actif ? setConfirmer({ id: i.id, geste: "actif" }) : action({ type: "actif", id: i.id, actif: true }, "Réactivée."))}
                    >
                      {i.actif ? "Désactiver" : "Réactiver"}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="details"
          onSubmit={(e) => {
            e.preventDefault();
            demanderUrl({ type: "ajouter", ...nouvelle });
          }}
        >
          <div className="champ">
            <label htmlFor={`${ids}-nom`}>Nom</label>
            <input id={`${ids}-nom`} required maxLength={40} value={nouvelle.nom} onChange={(e) => setNouvelle({ ...nouvelle, nom: e.target.value })} placeholder="Imprimante pizza" />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-station`}>Poste</label>
            <select id={`${ids}-station`} value={nouvelle.station} onChange={(e) => setNouvelle({ ...nouvelle, station: e.target.value as "pizza" | "cuisine" })}>
              <option value="pizza">Pizza</option>
              <option value="cuisine">Cuisine</option>
            </select>
          </div>
          <button type="submit" className="bouton-second champ-large">
            Ajouter l&apos;imprimante
          </button>
        </form>
      </section>
      <section className="ges-bloc">
        <h2>Alerte de commande en attente</h2>
        <p>Un e-mail part au restaurant quand une commande du jour n&apos;est pas acceptée après ce délai.</p>
        <form
          className="ges-retraits"
          onSubmit={(e) => {
            e.preventDefault();
            action({ type: "alerte", minutes: Number(alerte) }, "Enregistré.");
          }}
        >
          <div className="champ">
            <label htmlFor={`${ids}-alerte`}>Délai (minutes)</label>
            <input id={`${ids}-alerte`} inputMode="numeric" value={alerte} onChange={(e) => setAlerte(e.target.value)} />
          </div>
          <button type="submit" className="bouton-second">
            Enregistrer
          </button>
        </form>
      </section>
      {message && (
        <p className="tab-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
