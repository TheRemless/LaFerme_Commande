"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { adresseTexte, chercherAdresses, type Adresse, type Details } from "@/lib/adresse";
import { ecrireChoix, lireChoix, type Quand, type ZoneChoisie } from "@/lib/choix";
import { prixCourt } from "@/lib/prix";
import {
  creneaux,
  enMinutes,
  etatService,
  heureTexte,
  jourTexte,
  messagePause,
  zonePour,
  type ConfigService,
  type Mode,
} from "@/lib/service";
import { Icone } from "@/components/Icone";

type Verdict =
  | { statut: "livrable"; zone: ZoneChoisie; verifiee: boolean; controleImpossible?: boolean }
  | { statut: "hors-zone" }
  | { statut: "attente" };

const DETAILS_VIDES: Details = { etage: "", sonnette: "", code: "", instructions: "" };

export type AdresseEnregistree = { id: string; adresse: Adresse; details: Partial<Details> };

export function ChoixCommande({
  config,
  maintenantServeur,
  heureSimulee,
  adressesEnregistrees = [],
}: {
  config: ConfigService;
  maintenantServeur: number;
  heureSimulee?: string;
  adressesEnregistrees?: AdresseEnregistree[];
}) {
  const router = useRouter();
  const ids = useId();
  const [mode, setMode] = useState<Mode>("livraison");
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [rechercheEchouee, setRechercheEchouee] = useState(false);
  const [adresse, setAdresse] = useState<Adresse | null>(null);
  const [manuel, setManuel] = useState(false);
  const [adresseManuelle, setAdresseManuelle] = useState({ rue: "", numero: "", npa: "", localite: "" });
  const [verdict, setVerdict] = useState<Verdict>({ statut: "attente" });
  const [details, setDetails] = useState<Details>(DETAILS_VIDES);
  const [plusTard, setPlusTard] = useState(false);
  const [creneauChoisi, setCreneauChoisi] = useState<string>("");
  // L'heure du serveur fait foi : l'horloge d'un téléphone peut être fausse.
  const [maintenant, setMaintenant] = useState(() => new Date(maintenantServeur));

  useEffect(() => {
    const decalage = maintenantServeur - Date.now();
    const tic = window.setInterval(() => setMaintenant(new Date(Date.now() + decalage)), 30_000);
    return () => window.clearInterval(tic);
  }, [maintenantServeur]);

  // Reprendre le choix précédent (retour depuis la carte avec « Modifier »).
  useEffect(() => {
    const c = lireChoix();
    if (!c) return;
    setMode(c.mode);
    if (c.adresse) {
      setAdresse(c.adresse);
      setSaisie(`${c.adresse.rue}${c.adresse.numero ? ` ${c.adresse.numero}` : ""}`);
    }
    if (c.details) setDetails(c.details);
  }, []);

  // Suggestions geo.admin, 250 ms après la dernière frappe.
  useEffect(() => {
    if (adresse || manuel || saisie.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      chercherAdresses(saisie, ctrl.signal)
        .then((r) => {
          setSuggestions(r);
          setRechercheEchouee(false);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setRechercheEchouee(true);
        });
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [saisie, adresse, manuel]);

  const adresseRetenue: Adresse | null = manuel
    ? /^\d{4}$/.test(adresseManuelle.npa) && adresseManuelle.rue && adresseManuelle.localite
      ? adresseManuelle
      : null
    : adresse;

  // Zone : réponse immédiate calculée ici, puis contrôle du serveur qui fait foi.
  useEffect(() => {
    if (mode !== "livraison" || !adresseRetenue) {
      setVerdict({ statut: "attente" });
      return;
    }
    const local = zonePour(config, adresseRetenue.npa, adresseRetenue.localite);
    setVerdict(local.statut === "livrable" ? { statut: "livrable", zone: local.zone, verifiee: false } : { statut: "hors-zone" });
    const ctrl = new AbortController();
    fetch("/api/adresse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adresseRetenue.featureId ? { featureId: adresseRetenue.featureId } : adresseRetenue),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((r: { statut?: string; zone?: ZoneChoisie; verifiee?: boolean }) => {
        if (r.statut === "livrable" && r.zone) setVerdict({ statut: "livrable", zone: r.zone, verifiee: Boolean(r.verifiee) });
        else if (r.statut === "hors-zone") setVerdict({ statut: "hors-zone" });
        else setVerdict((v) => (v.statut === "livrable" ? { ...v, controleImpossible: true } : v));
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setVerdict((v) => (v.statut === "livrable" ? { ...v, controleImpossible: true } : v));
      });
    return () => ctrl.abort();
    // adresseRetenue change d'identité à chaque rendu en saisie manuelle : on suit ses champs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, adresseRetenue?.featureId, adresseRetenue?.npa, adresseRetenue?.localite, adresseRetenue?.rue, config]);

  const zone = mode === "livraison" && verdict.statut === "livrable" ? config.zones.find((z) => z.numero === verdict.zone.numero) : undefined;
  // Deux calculs : carte complète, et panier 100 % pizzas (dernière commande plus tardive le soir).
  // On montre le plus large ; ce qui ne vaut que pour les pizzas est signalé et suit dans le choix.
  const etatCarte = useMemo(() => etatService(config, maintenant, mode, zone), [config, maintenant, mode, zone]);
  const etatPizzas = useMemo(() => etatService(config, maintenant, mode, zone, true), [config, maintenant, mode, zone]);
  const asapPizzasSeulement = etatCarte.etat !== "ouvert" && etatPizzas.etat === "ouvert";
  const etat = asapPizzasSeulement ? etatPizzas : etatCarte;
  const listeCarte = useMemo(() => creneaux(config, maintenant, mode, zone), [config, maintenant, mode, zone]);
  const liste = useMemo(() => creneaux(config, maintenant, mode, zone, true), [config, maintenant, mode, zone]);
  const pourTous = useMemo(() => new Set(listeCarte.map((c) => `${c.date} ${c.minutes}`)), [listeCarte]);
  const derniereCarte = config.horaires.find((h) => h.derniere_commande !== h.derniere_commande_pizzas)?.derniere_commande;
  const jours = useMemo(() => [...new Set(liste.map((c) => c.date))], [liste]);
  const [jourChoisi, setJourChoisi] = useState("");
  const jour = jours.includes(jourChoisi) ? jourChoisi : (jours[0] ?? "");
  const heuresDuJour = liste.filter((c) => c.date === jour);
  const heure = heuresDuJour.some((c) => String(c.minutes) === creneauChoisi) ? creneauChoisi : String(heuresDuJour[0]?.minutes ?? "");

  const pretAdresse = mode === "retrait" || verdict.statut === "livrable";
  const pretDetails = mode === "retrait" || details.sonnette.trim() !== "";
  const asap = etat.etat === "ouvert" && !plusTard;
  const suspendu = messagePause(etat);
  const quand: Quand = etat.etat === "fermeture" || etat.etat === "aucun-creneau" || suspendu
    ? { type: "aucun" }
    : asap
      ? { type: "asap" }
      : jour && heure
        ? { type: "creneau", date: jour, minutes: Number(heure) }
        : { type: "aucun" };
  const peutContinuer = pretAdresse && pretDetails;

  function continuer() {
    if (!peutContinuer) return;
    ecrireChoix({
      mode,
      adresse: mode === "livraison" ? (adresseRetenue ?? undefined) : undefined,
      details: mode === "livraison" ? details : undefined,
      zone: mode === "livraison" && verdict.statut === "livrable" ? verdict.zone : undefined,
      quand,
      pizzasSeulement:
        quand.type === "asap" ? asapPizzasSeulement : quand.type === "creneau" ? !pourTous.has(`${quand.date} ${quand.minutes}`) : false,
      heureSimulee,
    });
    router.push("/carte");
  }

  function choisirSuggestion(a: Adresse) {
    setAdresse(a);
    setSaisie(`${a.rue}${a.numero ? ` ${a.numero}` : ""}`);
    setSuggestions([]);
  }

  function choisirEnregistree(a: AdresseEnregistree) {
    setManuel(false);
    choisirSuggestion(a.adresse);
    setDetails({ ...DETAILS_VIDES, ...a.details });
  }

  function effacerAdresse() {
    setAdresse(null);
    setSaisie("");
    setVerdict({ statut: "attente" });
  }

  const champ = (cle: keyof Details) => ({
    id: `${ids}-${cle}`,
    value: details[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDetails({ ...details, [cle]: e.target.value }),
  });

  return (
    <section className="accueil">
      <figure className="accueil-photo">
        <Image src="/accueil.jpg" alt="Pizzas, pâtes et burger de La Ferme vus du dessus" fill priority sizes="100vw" />
      </figure>
      <div className="accueil-panneau">
        <h1>Livraison ou à emporter&nbsp;?</h1>

        <div className="choix-mode" role="group" aria-label="Livraison ou à emporter">
          <button type="button" aria-pressed={mode === "livraison"} onClick={() => setMode("livraison")}>
            <span className="choix-titre">Livraison</span>
            <span className="choix-sous">par les livreurs du restaurant</span>
          </button>
          <button type="button" aria-pressed={mode === "retrait"} onClick={() => setMode("retrait")}>
            <span className="choix-titre">À emporter</span>
            <span className="choix-sous">Route de Chancy 132, Onex</span>
          </button>
        </div>

        {suspendu && (
          <div className="verdict verdict-info" role="status">
            <p className="verdict-titre">{suspendu}</p>
            {etat.etat === "livraison-fermee" && (
              <button type="button" className="bouton-second" onClick={() => setMode("retrait")}>
                Commander à emporter
              </button>
            )}
          </div>
        )}

        {etat.etat === "fermeture" && (
          <div className="verdict verdict-info" role="status">
            <p className="verdict-titre">
              Fermé du {jourTexte(etat.fermeture.debut)} au {jourTexte(etat.fermeture.fin)}.
            </p>
            {etat.reouverture && <p>On rouvre le {jourTexte(etat.reouverture)}.</p>}
          </div>
        )}

        {mode === "livraison" && (
          <>
            {!adresse && !manuel && adressesEnregistrees.length > 0 && (
              <fieldset className="adresses-enregistrees">
                <legend>Vos adresses</legend>
                {adressesEnregistrees.map((a) => (
                  <button key={a.id} type="button" onClick={() => choisirEnregistree(a)}>
                    <Icone nom="repere" />
                    <span>
                      <strong>
                        {a.adresse.rue} {a.adresse.numero}
                      </strong>{" "}
                      {a.adresse.npa} {a.adresse.localite}
                    </span>
                  </button>
                ))}
              </fieldset>
            )}
            {!manuel ? (
              <div className="champ champ-adresse">
                <label htmlFor={`${ids}-adresse`}>Adresse de livraison</label>
                <div className="saisie-adresse">
                  <Icone nom="repere" />
                  <input
                    id={`${ids}-adresse`}
                    type="text"
                    autoComplete="street-address"
                    placeholder="Rue et numéro"
                    value={saisie}
                    onChange={(e) => {
                      setSaisie(e.target.value);
                      setAdresse(null);
                    }}
                    aria-describedby={rechercheEchouee ? `${ids}-erreur` : undefined}
                  />
                  {adresse && (
                    <button type="button" className="effacer" onClick={effacerAdresse} aria-label="Changer d'adresse">
                      <Icone nom="fermer" />
                    </button>
                  )}
                </div>
                {suggestions.length > 0 && (
                  <ul className="suggestions">
                    {suggestions.map((s) => (
                      <li key={`${s.featureId}-${s.numero}`}>
                        <button type="button" onClick={() => choisirSuggestion(s)}>
                          <strong>
                            {s.rue} {s.numero}
                          </strong>{" "}
                          {s.npa} {s.localite}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {rechercheEchouee && (
                  <p className="aide" id={`${ids}-erreur`} role="alert">
                    La recherche d&apos;adresses ne répond pas.
                  </p>
                )}
                {!adresse && saisie.trim().length >= 3 && (
                  <button type="button" className="lien" onClick={() => setManuel(true)}>
                    Mon adresse n&apos;apparaît pas
                  </button>
                )}
              </div>
            ) : (
              <fieldset className="details">
                <legend className="champ-large">Adresse de livraison</legend>
                <div className="champ champ-large">
                  <label htmlFor={`${ids}-rue`}>Rue</label>
                  <input id={`${ids}-rue`} autoComplete="address-line1" value={adresseManuelle.rue} onChange={(e) => setAdresseManuelle({ ...adresseManuelle, rue: e.target.value })} />
                </div>
                <div className="champ">
                  <label htmlFor={`${ids}-numero`}>Numéro</label>
                  <input id={`${ids}-numero`} value={adresseManuelle.numero} onChange={(e) => setAdresseManuelle({ ...adresseManuelle, numero: e.target.value })} />
                </div>
                <div className="champ">
                  <label htmlFor={`${ids}-npa`}>NPA</label>
                  <input id={`${ids}-npa`} inputMode="numeric" autoComplete="postal-code" maxLength={4} value={adresseManuelle.npa} onChange={(e) => setAdresseManuelle({ ...adresseManuelle, npa: e.target.value.replace(/\D/g, "") })} />
                </div>
                <div className="champ">
                  <label htmlFor={`${ids}-localite`}>Localité</label>
                  <input id={`${ids}-localite`} autoComplete="address-level2" value={adresseManuelle.localite} onChange={(e) => setAdresseManuelle({ ...adresseManuelle, localite: e.target.value })} />
                </div>
                <button type="button" className="lien champ-large" onClick={() => setManuel(false)}>
                  Revenir à la recherche
                </button>
              </fieldset>
            )}

            {verdict.statut === "livrable" && (
              <>
                <div className="verdict verdict-ok" role="status">
                  <p className="verdict-titre">
                    <Icone nom="ok" /> Dans notre zone de livraison
                  </p>
                  <dl className="chiffres">
                    <div>
                      <dt>Livraison</dt>
                      <dd>{prixCourt(verdict.zone.frais_centimes)}</dd>
                    </div>
                    <div>
                      <dt>Minimum</dt>
                      <dd>{prixCourt(verdict.zone.minimum_centimes)}</dd>
                    </div>
                    <div>
                      <dt>{etat.etat === "ouvert" ? "Chez vous vers" : "Délai"}</dt>
                      <dd>
                        {etat.etat === "ouvert"
                          ? heureTexte(etat.desQuePossible)
                          : `${verdict.zone.delai_min} à ${verdict.zone.delai_max} min`}
                      </dd>
                    </div>
                  </dl>
                  {verdict.controleImpossible && <p className="aide">Adresse contrôlée de nouveau au moment de payer.</p>}
                </div>
                <div className="details">
                  <div className="champ">
                    <label htmlFor={`${ids}-etage`}>
                      Étage <span className="facultatif">facultatif</span>
                    </label>
                    <input {...champ("etage")} />
                  </div>
                  <div className="champ">
                    <label htmlFor={`${ids}-sonnette`}>Nom sur la sonnette</label>
                    <input {...champ("sonnette")} autoComplete="family-name" />
                  </div>
                  <div className="champ">
                    <label htmlFor={`${ids}-code`}>
                      Code d&apos;entrée <span className="facultatif">facultatif</span>
                    </label>
                    <input {...champ("code")} />
                  </div>
                  <div className="champ champ-large">
                    <label htmlFor={`${ids}-instructions`}>
                      Pour le livreur <span className="facultatif">facultatif</span>
                    </label>
                    <input {...champ("instructions")} maxLength={140} />
                  </div>
                </div>
              </>
            )}

            {verdict.statut === "hors-zone" && adresseRetenue && (
              <div className="verdict verdict-hors" role="status">
                <p className="verdict-titre">{adresseTexte(adresseRetenue)} est hors de notre zone de livraison.</p>
                <p>Vous pouvez commander à emporter et passer la prendre au restaurant, Route de Chancy 132 à Onex.</p>
                <button type="button" className="bouton-second" onClick={() => setMode("retrait")}>
                  Commander à emporter
                </button>
              </div>
            )}
          </>
        )}

        {mode === "retrait" && etat.etat === "ouvert" && (
          <div className="verdict verdict-ok">
            <dl className="chiffres">
              <div>
                <dt>Prête vers</dt>
                <dd>{heureTexte(etat.desQuePossible)}</dd>
              </div>
            </dl>
          </div>
        )}

        {pretAdresse && (etat.etat === "ouvert" || etat.etat === "ferme") && (
          <fieldset className="quand">
            <legend>Pour quand ?</legend>
            {etat.etat === "ouvert" ? (
              <>
                <label className="option">
                  <input type="radio" name={`${ids}-quand`} checked={!plusTard} onChange={() => setPlusTard(false)} />
                  <span>Dès que possible, vers {heureTexte(etat.desQuePossible)}</span>
                </label>
                <label className="option">
                  <input type="radio" name={`${ids}-quand`} checked={plusTard} onChange={() => setPlusTard(true)} />
                  <span>Plus tard</span>
                </label>
                {asapPizzasSeulement && !plusTard && derniereCarte && (
                  <p className="aide">Après {heureTexte(enMinutes(derniereCarte))}, on ne prend plus que les pizzas.</p>
                )}
              </>
            ) : (
              <p className="aide-forte">
                La cuisine est fermée en ce moment. Vous pouvez déjà commander pour le {jourTexte(etat.prochain.date)}, à partir de{" "}
                {heureTexte(etat.prochain.minutes)}.
              </p>
            )}
            {(plusTard || etat.etat === "ferme") && (
              <div className="creneau">
                <div className="champ">
                  <label htmlFor={`${ids}-jour`}>Jour</label>
                  <select id={`${ids}-jour`} value={jour} onChange={(e) => setJourChoisi(e.target.value)}>
                    {jours.map((d) => (
                      <option key={d} value={d}>
                        {jourTexte(d)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="champ">
                  <label htmlFor={`${ids}-heure`}>Heure</label>
                  <select id={`${ids}-heure`} value={heure} onChange={(e) => setCreneauChoisi(e.target.value)}>
                    {heuresDuJour.map((c) => (
                      <option key={c.minutes} value={c.minutes}>
                        {heureTexte(c.minutes)}
                        {pourTous.has(`${c.date} ${c.minutes}`) ? "" : ", pizzas seulement"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </fieldset>
        )}

        {etat.etat === "aucun-creneau" && (
          <p className="aide-forte" role="status">
            Aucun créneau libre dans les {config.reglages.avance_jours} prochains jours. Une question ? 022 792 16 89.
          </p>
        )}

        <button type="button" className="bouton-principal" onClick={continuer} disabled={!peutContinuer}>
          Voir la carte
        </button>
        {mode === "livraison" && verdict.statut === "livrable" && !pretDetails && (
          <p className="aide">Indiquez le nom sur la sonnette pour continuer.</p>
        )}
      </div>
    </section>
  );
}
