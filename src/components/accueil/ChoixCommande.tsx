"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { adresseTexte, chercherAdresses, numeroTape, type Adresse, type Details } from "@/lib/adresse";
import { ecrireChoix, lireChoix, type Quand, type ZoneChoisie } from "@/lib/choix";
import { prixCourt } from "@/lib/prix";
import { retenirCodeDeLUrl } from "@/lib/code-client";
import { ancrePlat } from "@/lib/plat-adresse";
import { messageZoneFermee } from "@/lib/zone-fermee";
import { fourchette } from "@/lib/heure-reelle";
import { plageTexte } from "@/lib/plage-heure";
import {
  creneaux,
  depuisHeureGeneve,
  enMinutes,
  etatService,
  fermetureProche,
  heureTexte,
  serviceEnCours,
  instantGeneve,
  jourTexte,
  messagePause,
  zonePour,
  type ConfigService,
  type Mode,
  creneauxLibres,
  type CreneauPlein,
} from "@/lib/service";
import { Icone } from "@/components/Icone";
import { RepriseCommande, type DerniereCommande } from "@/components/accueil/RepriseCommande";

type Verdict =
  // adresse : l'adresse officielle du registre fédéral quand le serveur l'a retrouvée (saisie à la main).
  | { statut: "livrable"; zone: ZoneChoisie; verifiee: boolean; controleImpossible?: boolean; adresse?: Adresse }
  | { statut: "hors-zone" }
  // Zone fermée jusqu'à une heure (back-office) : on dit quand la livraison reprend.
  | { statut: "zone-fermee"; jusqua: string }
  | { statut: "introuvable"; message: string }
  | { statut: "verification" }
  | { statut: "attente" };

const DETAILS_VIDES: Details = { etage: "", sonnette: "", code: "", instructions: "" };

export type AdresseEnregistree = { id: string; adresse: Adresse; details: Partial<Details> };

type ReponseAccueil = {
  maintenant: number;
  heureSimulee: string | null;
  adresses: AdresseEnregistree[];
  derniere?: DerniereCommande | null;
  pleins?: CreneauPlein[];
};

export function ChoixCommande({
  config,
  maintenantServeur,
  preversion,
}: {
  config: ConfigService;
  maintenantServeur: number;
  preversion: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [mode, setMode] = useState<Mode>("livraison");
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [rechercheEchouee, setRechercheEchouee] = useState(false);
  const [adresse, setAdresse] = useState<Adresse | null>(null);
  // Client connecté : sa dernière commande, à reprendre dès l'accueil (vague 3). Une fois reprise, le
  // bouton mène au panier au lieu de la carte.
  const [derniere, setDerniere] = useState<DerniereCommande | null>(null);
  const [reprise, setReprise] = useState(false);
  // Numéro tapé quand la suggestion choisie en porte un autre (CM-07).
  const [numeroDifferent, setNumeroDifferent] = useState<string | null>(null);
  const [manuel, setManuel] = useState(false);
  const [adresseManuelle, setAdresseManuelle] = useState({ rue: "", numero: "", npa: "", localite: "" });
  const [verdict, setVerdict] = useState<Verdict>({ statut: "attente" });
  const [details, setDetails] = useState<Details>(DETAILS_VIDES);
  const [plusTard, setPlusTard] = useState(false);
  const [creneauChoisi, setCreneauChoisi] = useState<string>("");
  const [maintenant, setMaintenant] = useState(() => new Date(maintenantServeur));
  const [heureSimulee, setHeureSimulee] = useState<string | undefined>();
  const [adressesEnregistrees, setAdressesEnregistrees] = useState<AdresseEnregistree[]>([]);
  // Créneaux pleins (capacité atteinte) : jamais proposés, le premier proposé est le suivant libre.
  const [pleins, setPleins] = useState<CreneauPlein[]>([]);
  const champAdresse = useRef<HTMLInputElement>(null);
  // Sur téléphone, « Voir la carte » tombe sous l'écran : après un geste du client (adresse choisie,
  // à emporter), on le fait monter juste assez pour le voir (CM-26).
  const boutonCarte = useRef<HTMLButtonElement>(null);
  const defiler = useRef(false);
  const [montrerBouton, setMontrerBouton] = useState(0);
  const montrer = () => {
    defiler.current = true;
    setMontrerBouton((n) => n + 1);
  };

  // La page vient du cache : l'heure où elle a été faite peut dater. On prend aussitôt celle du
  // téléphone, puis celle du serveur, qui fait foi (l'horloge d'un téléphone peut être fausse).
  // Le même appel rapporte les adresses d'un client connecté.
  useLayoutEffect(() => {
    const heure = new URLSearchParams(window.location.search).get("heure");
    // Préversion : ?heure=2026-11-10T19:05 (heure de Genève) simule un autre moment, dès le premier rendu.
    const simulee = preversion && heure ? depuisHeureGeneve(heure) : null;
    let decalage = simulee ? simulee.getTime() - Date.now() : 0;
    setMaintenant(new Date(Date.now() + decalage));
    if (simulee) setHeureSimulee(heure ?? undefined);
    const tic = window.setInterval(() => setMaintenant(new Date(Date.now() + decalage)), 30_000);
    const ctrl = new AbortController();
    const depart = Date.now();
    fetch(`/api/accueil${heure ? `?heure=${encodeURIComponent(heure)}` : ""}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ReponseAccueil>) : Promise.reject(new Error(`accueil ${r.status}`))))
      .then((r) => {
        // L'heure lue par le serveur date du milieu de l'aller-retour.
        decalage = r.maintenant - (depart + Date.now()) / 2;
        setMaintenant(new Date(Date.now() + decalage));
        setHeureSimulee(r.heureSimulee ?? undefined);
        setAdressesEnregistrees(r.adresses);
        setDerniere(r.derniere ?? null);
        setPleins(r.pleins ?? []);
      })
      .catch(() => {
        // Hors ligne ou serveur muet : on garde l'heure du téléphone, sans adresses enregistrées.
      });
    return () => {
      ctrl.abort();
      window.clearInterval(tic);
    };
  }, [preversion]);

  // Code apporté par un QR (/?code=FLYER) : gardé dans l'onglet, retiré de l'adresse.
  useEffect(() => retenirCodeDeLUrl(), []);

  // Reprendre le choix précédent (retour depuis la carte avec « Modifier »).
  useEffect(() => {
    const c = lireChoix();
    if (c) {
      setMode(c.mode);
      if (c.adresse) {
        setAdresse(c.adresse);
        setSaisie(`${c.adresse.rue}${c.adresse.numero ? ` ${c.adresse.numero}` : ""}`);
      }
      if (c.details) setDetails(c.details);
    }
    // Réseau lent (CM-21) : un tap sur « Livraison » ou « À emporter », ou une adresse tapée, avant que la
    // page réponde. Le petit script de src/app/page.tsx a gardé le tap ; le champ a gardé le texte.
    const w = window as Window & { __laFermePret?: boolean; __laFermeMode?: string };
    w.__laFermePret = true;
    if (w.__laFermeMode === "livraison" || w.__laFermeMode === "retrait") {
      setMode(w.__laFermeMode);
      if (w.__laFermeMode === "retrait") montrer();
    }
    delete w.__laFermeMode;
    // Texte gardé tel quel : couper l'espace finale (« Avenue du ») collerait le mot tapé ensuite.
    const tape = champAdresse.current?.value ?? "";
    if (tape.trim() && !c?.adresse) setSaisie(tape);
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
    ? /^\d{4}$/.test(adresseManuelle.npa) && adresseManuelle.rue.trim().length >= 3 && adresseManuelle.numero.trim() && adresseManuelle.localite
      ? adresseManuelle
      : null
    : adresse;

  // Zone : réponse immédiate calculée ici pour une adresse choisie dans les suggestions, puis contrôle du
  // serveur qui fait foi. Une adresse saisie à la main est d'abord retrouvée dans le registre fédéral par le
  // serveur, comme au paiement : on n'annonce rien avant sa réponse (rapport client mystère, CM-01).
  useEffect(() => {
    if (mode !== "livraison" || !adresseRetenue) {
      setVerdict({ statut: "attente" });
      return;
    }
    const local = zonePour(config, adresseRetenue.npa, adresseRetenue.localite);
    const verdictLocal: Verdict =
      local.statut === "livrable"
        ? { statut: "livrable", zone: local.zone, verifiee: false }
        : local.statut === "zone-fermee" && local.jusqua
          ? { statut: "zone-fermee", jusqua: local.jusqua }
          : { statut: "hors-zone" };
    const aLaMain = !adresseRetenue.featureId;
    setVerdict(aLaMain ? { statut: "verification" } : verdictLocal);
    const ctrl = new AbortController();
    const t = window.setTimeout(
      () => {
        fetch("/api/adresse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(adresseRetenue.featureId ? { featureId: adresseRetenue.featureId } : adresseRetenue),
          signal: ctrl.signal,
        })
          .then(async (r) => ({ code: r.status, corps: (await r.json()) as { statut?: string; zone?: ZoneChoisie; verifiee?: boolean; adresse?: Adresse; erreur?: string; jusqua?: string } }))
          .then(({ code, corps: r }) => {
            if (r.statut === "livrable" && r.zone) setVerdict({ statut: "livrable", zone: r.zone, verifiee: Boolean(r.verifiee), adresse: r.adresse });
            else if (r.statut === "hors-zone") setVerdict({ statut: "hors-zone" });
            else if (r.statut === "zone-fermee" && r.jusqua) setVerdict({ statut: "zone-fermee", jusqua: r.jusqua });
            else if (code === 422 && r.erreur) setVerdict({ statut: "introuvable", message: r.erreur });
            else setVerdict(verdictLocal.statut === "livrable" ? { ...verdictLocal, controleImpossible: true } : verdictLocal);
          })
          .catch((e) => {
            if (e instanceof DOMException && e.name === "AbortError") return;
            setVerdict(verdictLocal.statut === "livrable" ? { ...verdictLocal, controleImpossible: true } : verdictLocal);
          });
      },
      aLaMain ? 800 : 0,
    );
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
    // adresseRetenue change d'identité à chaque rendu en saisie manuelle : on suit ses champs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, adresseRetenue?.featureId, adresseRetenue?.npa, adresseRetenue?.localite, adresseRetenue?.rue, adresseRetenue?.numero, config]);

  const zone = mode === "livraison" && verdict.statut === "livrable" ? config.zones.find((z) => z.numero === verdict.zone.numero) : undefined;
  // Deux calculs : carte complète, et panier 100 % pizzas (dernière commande plus tardive le soir).
  // On montre le plus large ; ce qui ne vaut que pour les pizzas est signalé et suit dans le choix.
  const etatCarte = useMemo(() => etatService(config, maintenant, mode, zone), [config, maintenant, mode, zone]);
  const etatPizzas = useMemo(() => etatService(config, maintenant, mode, zone, true), [config, maintenant, mode, zone]);
  const asapPizzasSeulement = etatCarte.etat !== "ouvert" && etatPizzas.etat === "ouvert";
  const etat = asapPizzasSeulement ? etatPizzas : etatCarte;
  // Heure annoncée en fourchette autour de l'heure promise (largeur réglée au back-office).
  const plage = etat.etat === "ouvert" ? fourchette(config, mode, etat.desQuePossible) : null;
  const listeCarte = useMemo(() => creneauxLibres(creneaux(config, maintenant, mode, zone), pleins, mode), [config, maintenant, mode, zone, pleins]);
  const liste = useMemo(() => creneauxLibres(creneaux(config, maintenant, mode, zone, true), pleins, mode), [config, maintenant, mode, zone, pleins]);
  const fermetureAVenir = useMemo(() => fermetureProche(config, maintenant), [config, maintenant]);
  // Premier créneau proposé dans la liste (la plus large : pizzas comprises). Le message « fermé » le suit,
  // pour ne jamais annoncer demain quand la liste propose encore ce soir (CM-03).
  const premier = liste[0];
  const premierAujourdhui = premier?.date === instantGeneve(maintenant).date && serviceEnCours(config, maintenant);
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
  // Pendant une fermeture, les créneaux de la réouverture restent proposés s'ils tombent dans les jours
  // d'avance (CM-06). Sinon, aucune commande possible.
  const choixCreneau = etat.etat === "ferme" || (etat.etat === "fermeture" && liste.length > 0);
  const quand: Quand = (etat.etat === "fermeture" && liste.length === 0) || etat.etat === "aucun-creneau" || suspendu
    ? { type: "aucun" }
    : asap
      ? { type: "asap" }
      : jour && heure
        ? { type: "creneau", date: jour, minutes: Number(heure) }
        : { type: "aucun" };
  const peutContinuer = pretAdresse && pretDetails;

  // Une fois l'adresse acceptée (ou à emporter choisi), une seule fois par geste. Une adresse refusée
  // annule le geste : la saisie qui suit ne fait pas bouger la page.
  useEffect(() => {
    if (!defiler.current) return;
    // En livraison, on attend la réponse sur l'adresse.
    if (mode === "livraison" && (verdict.statut === "attente" || verdict.statut === "verification")) return;
    defiler.current = false;
    if (!pretAdresse || !boutonCarte.current) return;
    const b = boutonCarte.current.getBoundingClientRect();
    if (b.bottom <= window.innerHeight) return;
    const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    boutonCarte.current.scrollIntoView({ block: "nearest", behavior: doux ? "smooth" : "auto" });
  }, [montrerBouton, pretAdresse, verdict.statut, mode]);

  function continuer() {
    if (!peutContinuer) return;
    ecrireChoix({
      mode,
      // Saisie à la main retrouvée dans le registre : on garde l'adresse officielle et son identifiant.
      adresse: mode === "livraison" ? ((verdict.statut === "livrable" ? verdict.adresse : undefined) ?? adresseRetenue ?? undefined) : undefined,
      details: mode === "livraison" ? details : undefined,
      zone: mode === "livraison" && verdict.statut === "livrable" ? verdict.zone : undefined,
      quand,
      pizzasSeulement:
        quand.type === "asap" ? asapPizzasSeulement : quand.type === "creneau" ? !pourTous.has(`${quand.date} ${quand.minutes}`) : false,
      heureSimulee,
      estimation: quand.type === "asap" && etat.etat === "ouvert" ? etat.desQuePossible : undefined,
      fourchette: quand.type === "asap" && plage ? plage : undefined,
    });
    router.push(reprise ? "/panier" : `/carte${ancrePlat()}`);
  }

  function choisirSuggestion(a: Adresse) {
    const tape = numeroTape(saisie);
    setNumeroDifferent(tape && tape !== a.numero.toLowerCase() ? tape : null);
    setAdresse(a);
    setSaisie(`${a.rue}${a.numero ? ` ${a.numero}` : ""}`);
    setSuggestions([]);
    montrer();
  }

  function choisirEnregistree(a: AdresseEnregistree) {
    setManuel(false);
    choisirSuggestion(a.adresse);
    setNumeroDifferent(null);
    setDetails({ ...DETAILS_VIDES, ...a.details });
  }

  // Commande reprise : son mode, et pour une livraison l'adresse la plus récente du compte.
  function apresReprise(m: Mode) {
    setReprise(true);
    setMode(m);
    if (m === "livraison" && !adresse && adressesEnregistrees[0]) choisirEnregistree(adressesEnregistrees[0]);
    else montrer();
  }

  function effacerAdresse() {
    setNumeroDifferent(null);
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
        <h1>Livraison ou à&nbsp;emporter&nbsp;?</h1>
        {derniere && <RepriseCommande derniere={derniere} onReprise={apresReprise} />}

        <div className="choix-mode" role="group" aria-label="Livraison ou à emporter">
          <button type="button" data-mode="livraison" aria-pressed={mode === "livraison"} onClick={() => setMode("livraison")}>
            <span className="choix-titre">Livraison</span>
            <span className="choix-sous">par les livreurs du restaurant</span>
          </button>
          <button
            type="button"
            data-mode="retrait"
            aria-pressed={mode === "retrait"}
            onClick={() => {
              setMode("retrait");
              montrer();
            }}
          >
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
                    ref={champAdresse}
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
                {adresse && numeroDifferent && (
                  <p className="aide aide-erreur" role="status">
                    Vous aviez tapé le numéro {numeroDifferent}. Vérifiez que c&apos;est bien le vôtre.
                  </p>
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
                  {adresseManuelle.npa.length > 0 && adresseManuelle.npa.length < 4 && <p className="aide">Le NPA a quatre chiffres.</p>}
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
                      <dd>
                        <span className="devise">CHF</span>&nbsp;{prixCourt(verdict.zone.frais_centimes)}
                      </dd>
                    </div>
                    <div>
                      <dt>Minimum</dt>
                      <dd>
                        <span className="devise">CHF</span>&nbsp;{prixCourt(verdict.zone.minimum_centimes)}
                      </dd>
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
                  {manuel && verdict.adresse && <p className="aide">On livrera {adresseTexte(verdict.adresse)}.</p>}
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

            {verdict.statut === "verification" && (
              <p className="aide" role="status">
                Vérification de l&apos;adresse…
              </p>
            )}

            {verdict.statut === "introuvable" && (
              <div className="verdict verdict-hors" role="status">
                <p className="verdict-titre">{verdict.message}</p>
                <p>Vous pouvez aussi commander à emporter, Route de Chancy 132 à Onex.</p>
                <button type="button" className="bouton-second" onClick={() => setMode("retrait")}>
                  Commander à emporter
                </button>
              </div>
            )}

            {verdict.statut === "zone-fermee" && (
              <div className="verdict verdict-hors" role="status">
                <p className="verdict-titre">{messageZoneFermee(verdict.jusqua)}</p>
                <p>Vous pouvez commander à emporter et passer la prendre au restaurant, Route de Chancy 132 à Onex.</p>
                <button type="button" className="bouton-second" onClick={() => setMode("retrait")}>
                  Commander à emporter
                </button>
              </div>
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

        {pretAdresse && (etat.etat === "ouvert" || choixCreneau) && (
          <fieldset className="quand">
            <legend>Pour quand ?</legend>
            {etat.etat === "ouvert" ? (
              <>
                <label className="option">
                  <input type="radio" name={`${ids}-quand`} checked={!plusTard} onChange={() => setPlusTard(false)} />
                  <span>Dès que possible, {plage ? plageTexte(plage) : `vers ${heureTexte(etat.desQuePossible)}`}</span>
                </label>
                <label className="option">
                  <input type="radio" name={`${ids}-quand`} checked={plusTard} onChange={() => setPlusTard(true)} />
                  <span>Plus tard</span>
                </label>
                {asapPizzasSeulement && !plusTard && derniereCarte && (
                  <p className="aide">Après {heureTexte(enMinutes(derniereCarte))}, on ne prend plus que les pizzas.</p>
                )}
              </>
            ) : premier && premierAujourdhui ? (
              <p className="aide-forte">
                Trop tard pour «&nbsp;dès que possible&nbsp;». Vous pouvez encore commander pour {heureTexte(premier.minutes)}
                {pourTous.has(`${premier.date} ${premier.minutes}`) ? "" : ", pizzas seulement"}.
              </p>
            ) : premier ? (
              <p className="aide-forte">
                {etat.etat === "fermeture" ? "" : "La cuisine est fermée en ce moment. "}Vous pouvez déjà commander pour le{" "}
                {jourTexte(premier.date)}, à partir de {heureTexte(premier.minutes)}.
              </p>
            ) : null}
            {(plusTard || choixCreneau) && (
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

        {etat.etat === "aucun-creneau" &&
          (fermetureAVenir ? (
            <div className="verdict verdict-info" role="status">
              <p className="verdict-titre">
                Fermé du {jourTexte(fermetureAVenir.fermeture.debut)} au {jourTexte(fermetureAVenir.fermeture.fin)}.
              </p>
              {fermetureAVenir.reouverture && <p>On rouvre le {jourTexte(fermetureAVenir.reouverture)}.</p>}
            </div>
          ) : (
            <p className="aide-forte" role="status">
              Aucun créneau libre dans les {config.reglages.avance_jours} prochains jours. Une question ? 022 792 16 89.
            </p>
          ))}

        <button type="button" className="bouton-principal" ref={boutonCarte} onClick={continuer} disabled={!peutContinuer}>
          {reprise ? "Voir le panier" : "Voir la carte"}
        </button>
        {mode === "livraison" && verdict.statut === "livrable" && !pretDetails && (
          <p className="aide">Indiquez le nom sur la sonnette pour continuer.</p>
        )}
      </div>
    </section>
  );
}
