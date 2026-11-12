"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Geste, LivraisonLivreur, Probleme, RetireeLivreur } from "@/lib/livreur";
import { poster } from "@/lib/requete-client";
import { heureDe as heure } from "@/lib/heures";
import { prixChf } from "@/lib/prix";
import { lienNavigation, plateformeDe, type Plateforme } from "@/lib/navigation";
import { PROBLEME_LIBELLE, TELEPHONE_RESTAURANT } from "@/lib/livraisons-textes";

// Téléphone du livreur, tenu d'une main. Ses livraisons en cours dans l'ordre de passage, trois gestes.
// Un geste part avec une clé : sans réseau, il attend dans le téléphone (clé, commande, geste, sans
// adresse) et repart seul au retour du signal. Le serveur reconnaît la clé : jamais deux fois.
// Les adresses ne sont gardées qu'en mémoire, jamais dans le stockage du téléphone.

type Donnees = { livraisons: LivraisonLivreur[]; retirees: RetireeLivreur[] };
type EnAttente = { cle: string; commande: string; geste: Geste; motif?: Probleme; detail?: string; numero: number };

const STOCKAGE = "laferme-livreur-gestes";
const RELECTURE_MS = 15_000;
const RENVOI_MS = 5_000;
const PROBLEMES = Object.entries(PROBLEME_LIBELLE) as [Probleme, string][];

function lireAttente(): EnAttente[] {
  try {
    const v = JSON.parse(localStorage.getItem(STOCKAGE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function ecrireAttente(v: EnAttente[]) {
  try {
    if (v.length) localStorage.setItem(STOCKAGE, JSON.stringify(v));
    else localStorage.removeItem(STOCKAGE);
  } catch {
    // Stockage refusé (navigation privée) : le geste reste en mémoire jusqu'au rechargement.
  }
}

const cleNeuve = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const telLien = (t: string) => `tel:${t.replace(/[^+\d]/g, "")}`;

export function Livreur({ nom, supabase }: { nom: string; supabase: { url: string; cle: string } | null }) {
  const router = useRouter();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [dernierContact, setDernierContact] = useState<number | null>(null);
  const [attente, setAttente] = useState<EnAttente[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [plateforme, setPlateforme] = useState<Plateforme>("autre");
  const envoiEnCours = useRef(false);
  const attenteRef = useRef<EnAttente[]>([]);

  const majAttente = useCallback((v: EnAttente[]) => {
    attenteRef.current = v;
    ecrireAttente(v);
    setAttente(v);
  }, []);

  const charger = useCallback(async () => {
    try {
      const rep = await fetch("/api/livreur", { cache: "no-store" });
      if (rep.status === 401 || rep.status === 403) return router.refresh();
      if (!rep.ok) throw new Error(String(rep.status));
      setDonnees(await rep.json());
      setDernierContact(Date.now());
      setHorsLigne(false);
    } catch {
      setHorsLigne(true);
    }
  }, [router]);

  // Envoie les gestes en attente, un par un, dans l'ordre. Une coupure les garde pour le prochain essai.
  const vider = useCallback(async () => {
    if (envoiEnCours.current) return;
    envoiEnCours.current = true;
    try {
      while (attenteRef.current.length > 0) {
        const g = attenteRef.current[0];
        const { numero, ...corps } = g;
        const r = await poster("/api/livreur", corps);
        if (r.statut === 0 || r.statut >= 500) {
          // Pas de réseau, ou serveur qui ne répond pas : le geste reste et repart au prochain essai.
          setHorsLigne(true);
          break;
        }
        if (r.statut === 401) {
          // Session terminée : le geste attend la reconnexion, sur ce téléphone.
          router.refresh();
          break;
        }
        majAttente(attenteRef.current.filter((x) => x.cle !== g.cle));
        if (!r.ok) setMessage(`N° ${numero} : ${String(r.donnees.message ?? r.donnees.erreur ?? "Le geste n'est pas passé.")}`);
      }
    } finally {
      envoiEnCours.current = false;
    }
    await charger();
  }, [charger, majAttente, router]);

  useEffect(() => {
    setPlateforme(plateformeDe(navigator.userAgent, navigator.maxTouchPoints));
    attenteRef.current = lireAttente();
    setAttente(attenteRef.current);
    void vider();
  }, [vider]);

  useEffect(() => {
    const t = window.setInterval(() => (attenteRef.current.length ? vider() : charger()), attenteRef.current.length ? RENVOI_MS : RELECTURE_MS);
    return () => window.clearInterval(t);
  }, [charger, vider, attente.length]);

  useEffect(() => {
    const retour = () => {
      if (document.visibilityState === "visible") void vider();
    };
    window.addEventListener("online", retour);
    document.addEventListener("visibilitychange", retour);
    return () => {
      window.removeEventListener("online", retour);
      document.removeEventListener("visibilitychange", retour);
    };
  }, [vider]);

  // Même signal vide que la tablette : une commande réattribuée ou annulée se voit tout de suite.
  useEffect(() => {
    if (!supabase) return;
    let fermer: (() => void) | undefined;
    import("@supabase/supabase-js").then(({ createClient }) => {
      const client = createClient(supabase.url, supabase.cle, { auth: { persistSession: false } });
      const canal = client.channel("tablette").on("broadcast", { event: "commande" }, () => charger()).subscribe();
      fermer = () => void client.removeChannel(canal);
    });
    return () => fermer?.();
  }, [supabase, charger]);

  function geste(l: { commande_id: string; numero: number }, g: Geste, extra: { motif?: Probleme; detail?: string } = {}) {
    setMessage(null);
    majAttente([...attenteRef.current, { cle: cleNeuve(), commande: l.commande_id, geste: g, numero: l.numero, ...extra }]);
    void vider();
  }

  async function deconnecter() {
    await poster("/api/personnel/deconnexion", {});
    router.refresh();
  }

  const enAttentePour = (id: string) => attente.filter((g) => g.commande === id);
  const livraisons = donnees?.livraisons ?? [];
  const retirees = (donnees?.retirees ?? []).filter((r) => !attente.some((g) => g.commande === r.commande_id && g.geste === "compris"));
  // « Je pars » pour toutes celles encore au restaurant, quand il y en a plusieurs.
  const aPartir = livraisons.filter((l) => l.statut !== "partie" && !enAttentePour(l.commande_id).some((g) => g.geste === "partie" || g.geste === "livree"));

  return (
    <div className="livreur">
      <header className="liv-barre">
        <div>
          <h1>Mes livraisons</h1>
          <p>
            {nom}
            {donnees ? `, ${livraisons.length === 0 ? "rien en cours" : livraisons.length === 1 ? "1 livraison" : `${livraisons.length} livraisons`}` : ""}
          </p>
        </div>
        <button type="button" className="lien" onClick={deconnecter}>
          Déconnexion
        </button>
      </header>

      {horsLigne && (
        <p className="liv-alerte" role="alert">
          Pas de réseau{dernierContact ? ` depuis ${heure(new Date(dernierContact).toISOString())}` : ""}.{" "}
          {attente.length > 0 ? "Vos gestes partiront seuls au retour du signal." : "La liste se met à jour au retour du signal."}
        </p>
      )}
      {attente.length > 0 && !horsLigne && (
        <p className="liv-info" role="status">
          Envoi en cours…
        </p>
      )}
      {message && (
        <p className="liv-info" role="status">
          {message}
        </p>
      )}

      {retirees.map((r) => (
        <div key={r.commande_id} className="liv-retiree" role="alert">
          <p>
            <strong>N° {r.numero} </strong>
            {r.raison === "client_absent"
              ? "close, client absent. Rapportez le sac au restaurant."
              : r.raison === "annulee"
              ? r.partie
                ? "annulée. Ne la livrez pas, rapportez le sac au restaurant."
                : "annulée. Ne la prenez pas."
              : r.partie
                ? "donnée à un autre livreur. Si vous avez le sac, appelez le restaurant."
                : "n'est plus à vous. Le restaurant l'a donnée à quelqu'un d'autre ou la reprend."}
          </p>
          <button type="button" className="bouton-second" onClick={() => geste(r, "compris")}>
            Compris
          </button>
        </div>
      ))}

      {aPartir.length > 1 && (
        <button type="button" className="bouton-principal liv-tout" onClick={() => aPartir.forEach((l) => geste(l, "partie"))}>
          Je pars avec les {aPartir.length}
        </button>
      )}

      {donnees === null ? (
        <p className="liv-vide">{horsLigne ? "Pas de réseau. Vos livraisons s'afficheront au retour du signal." : "Chargement…"}</p>
      ) : livraisons.length === 0 ? (
        <p className="liv-vide">Rien pour vous pour le moment. La page se met à jour seule.</p>
      ) : (
        <ol className="liv-liste">
          {livraisons.map((l, i) => (
            <Arret key={l.commande_id} l={l} rang={i + 1} plateforme={plateforme} attente={enAttentePour(l.commande_id)} geste={(g, extra) => geste(l, g, extra)} />
          ))}
        </ol>
      )}

      <p className="liv-pied">
        Restaurant : <a href={telLien(TELEPHONE_RESTAURANT)}>{TELEPHONE_RESTAURANT}</a>
      </p>
    </div>
  );
}

function Arret({
  l,
  rang,
  plateforme,
  attente,
  geste,
}: {
  l: LivraisonLivreur;
  rang: number;
  plateforme: Plateforme;
  attente: EnAttente[];
  geste: (g: Geste, extra?: { motif?: Probleme; detail?: string }) => void;
}) {
  const ids = useId();
  const [probleme, setProbleme] = useState<Probleme | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [detail, setDetail] = useState("");
  const livreeEnAttente = attente.some((g) => g.geste === "livree");
  const partie = l.statut === "partie" || attente.some((g) => g.geste === "partie");
  const problemeEnAttente = attente.find((g) => g.geste === "probleme");
  const d = l.details;
  const acces = [d?.etage && `Étage ${d.etage}`, d?.sonnette && `Sonnette ${d.sonnette}`, d?.code && `Code ${d.code}`].filter(Boolean) as string[];
  const motifAffiche = problemeEnAttente?.motif ?? l.probleme;

  return (
    <li className={`liv-arret${livreeEnAttente ? " liv-arret-fini" : ""}`} aria-labelledby={`${ids}-titre`}>
      <div className="liv-tete">
        <p className="liv-rang" aria-label={`Arrêt ${rang}`}>
          {rang}
        </p>
        <h2 id={`${ids}-titre`} className="liv-heure">
          {l.heure ? heure(l.heure) : "dès que possible"}
          <span className="sr-only">, commande {l.numero}</span>
        </h2>
        <p className="liv-num">n° {l.numero}</p>
      </div>

      <p className="liv-etat">
        {livreeEnAttente ? "Livrée, envoi en attente du réseau." : partie ? `En route${attente.some((g) => g.geste === "partie") ? ", envoi en attente du réseau" : ""}.` : "À prendre au restaurant."}
      </p>

      <address className="liv-adresse">
        {l.adresse.rue} {l.adresse.numero}
        <br />
        {l.adresse.npa} {l.adresse.localite}
      </address>
      {acces.length > 0 && (
        <ul className="liv-acces">
          {acces.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {d?.instructions && <p className="liv-consigne">« {d.instructions} »</p>}
      <p className="liv-contenu">
        {l.articles} {l.articles > 1 ? "articles" : "article"}
        {l.pizzas > 0 ? `, dont ${l.pizzas} ${l.pizzas > 1 ? "pizzas" : "pizza"}` : ""}. {l.paye ? "Payée en ligne, rien à encaisser." : `À encaisser : ${prixChf(l.total_centimes)}.`}
      </p>

      {motifAffiche && (
        <p className="liv-probleme">
          Problème signalé : {PROBLEMES.find(([m]) => m === motifAffiche)?.[1].toLowerCase()}
          {(problemeEnAttente?.detail ?? l.probleme_detail) ? `, « ${problemeEnAttente?.detail ?? l.probleme_detail} »` : ""}.{" "}
          {problemeEnAttente ? "Envoi en attente du réseau." : "Le restaurant est prévenu."}
        </p>
      )}

      <div className="liv-liens">
        <a className="bouton-second" href={lienNavigation(l.adresse, plateforme)} target="_blank" rel="noreferrer noopener">
          Itinéraire
        </a>
        <a className="bouton-second" href={telLien(l.telephone)}>
          Appeler {l.prenom}
        </a>
      </div>

      {!livreeEnAttente && !ouvert && (
        <div className="liv-gestes">
          {partie ? (
            <button type="button" className="bouton-principal" onClick={() => geste("livree")}>
              Livrée
            </button>
          ) : (
            <button type="button" className="bouton-principal" onClick={() => geste("partie")}>
              Je pars
            </button>
          )}
          <button type="button" className="bouton-second" onClick={() => setOuvert(true)}>
            Problème
          </button>
        </div>
      )}

      {ouvert && (
        <fieldset className="liv-panneau">
          <legend>Quel problème ?</legend>
          <div className="liv-motifs">
            {PROBLEMES.map(([m, texte]) => (
              <button key={m} type="button" className="bouton-second" aria-pressed={probleme === m} onClick={() => setProbleme(m)}>
                {texte}
              </button>
            ))}
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-mot`}>Un mot pour le restaurant{probleme === "autre" ? "" : " (facultatif)"}</label>
            <textarea id={`${ids}-mot`} rows={2} maxLength={200} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </div>
          <button
            type="button"
            className="bouton-principal"
            disabled={!probleme || (probleme === "autre" && detail.trim().length === 0)}
            onClick={() => {
              if (!probleme) return;
              geste("probleme", { motif: probleme, detail: detail.trim() || undefined });
              setOuvert(false);
              setDetail("");
              setProbleme(null);
            }}
          >
            Prévenir le restaurant
          </button>
          <button type="button" className="lien" onClick={() => setOuvert(false)}>
            Fermer
          </button>
        </fieldset>
      )}
    </li>
  );
}
