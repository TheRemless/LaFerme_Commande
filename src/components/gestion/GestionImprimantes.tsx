"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { jourTexte } from "@/lib/service";
import "./imprimantes.css";
import { poster } from "@/lib/requete-client";

type Resume = { dernier_ticket_le: string | null; en_attente: number; plus_ancien_en_attente_le: string | null; imprimes_aujourdhui: number; echecs_aujourdhui: number };
type Imprimante = {
  id: number;
  nom: string;
  station: "pizza" | "cuisine";
  actif: boolean;
  liee: boolean;
  vue_le: string | null;
  en_ligne: boolean;
  statut_code: string | null;
  // Ce que l'imprimante a vraiment fait (vague 3, migration 20261130150000) ; null avant la migration.
  resume?: Resume | null;
};

// « Dernier ticket : 19h42 » (ou « hier 22h10 », « le 12 novembre ») ; en attente et échecs écrits en clair.
function lignesResume(r: Resume): string[] {
  const l: string[] = [];
  if (r.dernier_ticket_le) {
    const jour = jourGeneveDe(r.dernier_ticket_le);
    const aujourdHui = jourGeneveDe(new Date());
    const quand = jour === aujourdHui ? heureDe(r.dernier_ticket_le) : `${jourTexte(jour)}, ${heureDe(r.dernier_ticket_le)}`;
    l.push(`Dernier ticket sorti : ${quand}.`);
  } else l.push("Aucun ticket sorti pour l'instant.");
  if (r.en_attente > 0) {
    l.push(`${r.en_attente} ticket${r.en_attente > 1 ? "s" : ""} en attente${r.plus_ancien_en_attente_le ? ` depuis ${heureDe(r.plus_ancien_en_attente_le)}` : ""}.`);
  }
  l.push(`Aujourd'hui : ${r.imprimes_aujourdhui} imprimé${r.imprimes_aujourdhui > 1 ? "s" : ""}${r.echecs_aujourdhui ? `, ${r.echecs_aujourdhui} en échec` : ""}.`);
  return l;
}

export function GestionImprimantes() {
  const ids = useId();
  const [d, setD] = useState<{ imprimantes: Imprimante[]; alerte_minutes: number } | null>(null);
  const [nouvelle, setNouvelle] = useState({ nom: "", station: "pizza" as "pizza" | "cuisine" });
  const [url, setUrl] = useState<string | null>(null);
  const [alerte, setAlerte] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Confirmation avant un geste qui arrête une imprimante (audit du gérant, G10).
  const [confirmer, setConfirmer] = useState<{ id: number; geste: "jeton" | "actif" } | null>(null);
  // Imprimante en panne : ses tickets en attente partent sur une autre (vague 3, P1 de produit-gestion).
  const [renvoi, setRenvoi] = useState<{ id: number; vers: string } | null>(null);

  async function renvoyer(de: Imprimante) {
    if (!renvoi || !d) return;
    const vers = d.imprimantes.find((x) => String(x.id) === renvoi.vers);
    if (!vers) return;
    setMessage(null);
    const r = await poster("/api/gestion/imprimantes", { type: "renvoyer", id: de.id, vers: vers.id });
    if (!r.ok) return setMessage(String(r.donnees.erreur ?? "Pas enregistré."));
    const n = Number(r.donnees.tickets ?? 0);
    setRenvoi(null);
    setMessage(
      n === 0
        ? `Aucun ticket à renvoyer : ${de.nom} n'avait rien en attente pour une commande en cours.`
        : `${n} ticket${n > 1 ? "s" : ""} de ${de.nom} renvoyé${n > 1 ? "s" : ""} sur ${vers.nom}. Les prochains tickets vont encore à ${de.nom} tant qu'elle est active : désactivez-la s'il le faut.`,
    );
    await charger();
  }

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
    // L'état change en direct (en ligne, papier, tickets) : relu toutes les 30 secondes.
    const t = window.setInterval(charger, 30_000);
    return () => window.clearInterval(t);
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
        {/* Étapes génériques des imprimantes Star, données par le chef. NON VÉRIFIÉES : la notice Star (star-m.jp) a
            refusé la connexion le 13.11.2026 et aucune imprimante n'est encore branchée. À vérifier sur la vraie
            imprimante, puis retirer l'avertissement (docs/imprimantes-gestion.md). */}
        <details className="ges-imp-ou">
          <summary>Où coller l&apos;adresse dans l&apos;imprimante (Star)</summary>
          <p className="aide-forte">Non vérifié : à contrôler sur la vraie imprimante. La notice Star n&apos;a pas pu être lue.</p>
          <ol>
            <li>Trouver l&apos;adresse IP de l&apos;imprimante. L&apos;éteindre, puis la rallumer en tenant le bouton FEED : elle imprime une page d&apos;autotest qui donne son adresse IP.</li>
            <li>Sur un ordinateur ou la tablette branchés au même réseau, ouvrir un navigateur à cette adresse IP (précédée de http://). C&apos;est la page de réglages de l&apos;imprimante.</li>
            <li>Ouvrir la rubrique CloudPRNT, l&apos;activer, et coller l&apos;adresse ci-dessus dans le champ « Server URL ».</li>
            <li>Régler l&apos;intervalle de relève (le temps entre deux passages), puis enregistrer. Redémarrer l&apos;imprimante si la page le demande.</li>
            <li>Ici, « Imprimer un ticket de test » : le ticket « TEST » doit sortir.</li>
          </ol>
        </details>
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
                  {i.resume && (
                    <span className={i.resume.en_attente > 0 || i.resume.echecs_aujourdhui > 0 ? "ges-imp-resume ges-imp-alerte" : "ges-imp-resume"}>
                      {lignesResume(i.resume).map((l) => (
                        <span key={l}>{l}</span>
                      ))}
                    </span>
                  )}
                </span>
                {renvoi?.id === i.id ? (
                  <span className="ges-confirmer" role="group" aria-label={`Renvoyer les tickets de ${i.nom}`}>
                    <label htmlFor={`${ids}-renvoi-${i.id}`}>Renvoyer ses tickets en attente sur</label>
                    <select id={`${ids}-renvoi-${i.id}`} value={renvoi.vers} onChange={(e) => setRenvoi({ id: i.id, vers: e.target.value })}>
                      {d.imprimantes
                        .filter((x) => x.actif && x.id !== i.id)
                        .map((x) => (
                          <option key={x.id} value={String(x.id)}>
                            {x.nom}, poste {x.station}
                            {x.en_ligne ? "" : " (hors ligne)"}
                          </option>
                        ))}
                    </select>
                    <span className="boutons-ligne">
                      <button type="button" className="bouton-second" onClick={() => renvoyer(i)}>
                        Renvoyer les tickets
                      </button>
                      <button type="button" className="lien" onClick={() => setRenvoi(null)}>
                        Garder
                      </button>
                    </span>
                  </span>
                ) : confirmer?.id === i.id ? (
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
                    {i.actif && (
                      <button
                        type="button"
                        className="lien"
                        onClick={() =>
                          action(
                            { type: "test", id: i.id },
                            i.en_ligne
                              ? `Ticket de test envoyé à ${i.nom}. Il sort dans quelques secondes : vérifiez le papier.`
                              : `Ticket de test envoyé à ${i.nom}, hors ligne pour le moment : il sortira à sa reconnexion.`,
                          )
                        }
                      >
                        Imprimer un ticket de test
                      </button>
                    )}
                    {d.imprimantes.some((x) => x.actif && x.id !== i.id) && (
                      <button
                        type="button"
                        className="lien"
                        onClick={() => {
                          setConfirmer(null);
                          setRenvoi({ id: i.id, vers: String(d.imprimantes.find((x) => x.actif && x.id !== i.id)!.id) });
                        }}
                      >
                        Renvoyer ses tickets sur une autre
                      </button>
                    )}
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
      <section className="ges-bloc" aria-labelledby="imp-panne">
        <h2 id="imp-panne">En cas de panne</h2>
        <ol className="ges-imp-panne">
          <li>Sur la tablette, toucher « Ticket » sur la commande : il s&apos;affiche en grand, la cuisine lit l&apos;écran.</li>
          <li>Regarder l&apos;imprimante : papier, capot fermé, câble réseau branché des deux côtés, voyant allumé. L&apos;éteindre et la rallumer.</li>
          <li>
            Les tickets ne sont pas perdus : ils attendent et sortent tous dans l&apos;ordre au retour de l&apos;imprimante. Ne pas réimprimer avant, sinon ils
            sortent en double.
          </li>
          <li>
            Elle ne revient pas et une autre imprimante marche : « Renvoyer ses tickets sur une autre » ci-dessus. Ses tickets en attente y sortent, ceux
            peut-être déjà sortis marqués « RENVOI ». Pour les tickets suivants, la désactiver : ils iront à l&apos;autre imprimante du même poste, ou
            s&apos;afficheront sur la tablette.
          </li>
          <li>Un ticket manque après le retour : « Réimprimer » sur la commande, à la tablette.</li>
          <li>L&apos;imprimante est dite « en ligne » mais rien ne sort : « Nouvelle adresse » ci-dessus, puis la coller dans ses réglages.</li>
        </ol>
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
