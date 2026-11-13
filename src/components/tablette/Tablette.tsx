"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandeTablette } from "@/lib/tablette";
import { poster } from "@/lib/requete-client";
import { prixChf } from "@/lib/prix";
import { Reglages } from "@/components/tablette/Reglages";
import { TicketSecours } from "@/components/tablette/TicketSecours";
import type { EtatImpression } from "@/lib/impression/service";
import type { LigneTicket } from "@/lib/impression/ticket";
import { heureDe as heure, jourCourtDe as jourCourt, jourGeneveDe as jourGeneve } from "@/lib/heures";
import { heureImpression, IMPRESSION_AVANCE_DEFAUT, momentTexte, type DelaisImpression } from "@/lib/impression/avance";
import { heureTexte, jourTexte } from "@/lib/service";
import { MOTIFS_REFUS } from "@/lib/motifs";
import { nouvelleCle } from "@/lib/cle";
import type { DonneesLivraisons } from "@/lib/livreur";
import { MOTIF_CLIENT_ABSENT } from "@/lib/livraisons-textes";
import { OngletLivraisons, livraisonsEnCours, problemeTexte } from "@/components/tablette/Livraisons";
import { chercherCommandes, etatTemps, lignesImprimantes, minutesDeRetard, minutesRestantes, ordreStable, type Rythme } from "@/components/tablette/rush";
import { LigneCommande } from "@/components/tablette/LigneCommande";
import "./tablette.css";

// Tablette posée en cuisine : file des commandes, alerte sonore, accepter, refuser, statuts.
// Relecture toutes les 15 secondes en service, 60 hors service, 5 sans signal Realtime, et tout de suite quand Supabase Realtime signale un changement.

type Donnees = {
  maintenant: string;
  commandes: CommandeTablette[];
  reglages: {
    pause: { active: boolean; jusqua: string | null; livraisonFermee: boolean; auto?: boolean } | null;
    preparation_minutes: number;
    retard_minutes?: number;
    // Les tickets d'une commande acceptée sortent ce temps avant l'heure promise, par mode (SS-11).
    impression_avance?: DelaisImpression;
  };
  impression: EtatImpression;
  // Préparation habituelle et trajet de chaque zone : de quoi trier « En cours » par heure de lancement.
  rythme?: Rythme;
  // Rythme de relecture proposé par le serveur : 15 s pendant le service, 60 s hors service.
  relecture_s: number;
};

const RYTHME_DEFAUT: Rythme = { preparation: 20, trajets: {} };

// Sans signal Realtime, la tablette ne voit une nouvelle commande qu'en relisant : 5 s, à toute heure.
const RELECTURE_SANS_SIGNAL_MS = 5000;

type Tache = EtatImpression["taches"][number];

const ETAT_TACHE: Record<Tache["etat"], string> = {
  en_attente: "en file",
  envoyee: "en cours",
  imprimee: "imprimé",
  echec: "échec",
  sans_imprimante: "pas d'imprimante",
  annulee: "annulé",
};

function etatImprimante(i: EtatImpression["imprimantes"][number]): string {
  if (!i.en_ligne) return i.vue_le ? `hors ligne depuis ${heure(i.vue_le)}` : "jamais connectée";
  if (i.statut_code?.startsWith("410")) return "plus de papier";
  if (i.statut_code?.startsWith("420")) return "capot ouvert";
  if (i.statut_code && !i.statut_code.startsWith("2")) return `erreur ${i.statut_code}`;
  return "en ligne";
}

type Onglet = "traiter" | "cours" | "livraisons" | "avance" | "terminees";

const MOTIFS = MOTIFS_REFUS.map(([, m]) => m);

// Deux notes courtes, assez fortes pour une cuisine. Le navigateur n'autorise le son qu'après un geste.
function sonner(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [i, f] of [880, 660].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = "square";
    g.gain.setValueAtTime(0.0001, t + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.28 + 0.24);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.28);
    o.stop(t + i * 0.28 + 0.26);
  }
}

export function Tablette({ nom, gerant = false, supabase }: { nom: string; gerant?: boolean; supabase: { url: string; cle: string } | null }) {
  const router = useRouter();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [dernierContact, setDernierContact] = useState<number | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>("traiter");
  const [demarre, setDemarre] = useState(false);
  // Vrai seulement si le navigateur a accepté de jouer le son.
  const [son, setSon] = useState(false);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  // Retour du dernier geste. Un échec reste affiché jusqu'à « OK » : il ne doit pas passer inaperçu.
  const [message, setMessage] = useState<{ texte: string; echec: boolean } | null>(null);
  // Retrouver une commande au comptoir : numéro exact ou nom du client, toutes listes confondues.
  const [recherche, setRecherche] = useState("");
  // Commande ouverte en détail, à côté du tableau.
  const [ouverte, setOuverte] = useState<string | null>(null);
  const dernierAppui = useRef(0);
  // Hauteur de la barre collée en haut : le détail se place juste dessous.
  const barre = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = barre.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => document.documentElement.style.setProperty("--tab-barre-h", `${el.offsetHeight}px`));
    o.observe(el);
    return () => o.disconnect();
  }, []);
  const ordrePrecedent = useRef<string[]>([]);
  // Livreurs et tournées (onglet « Livraisons ») : relus avec la file, une panne ici ne la bloque pas.
  const [livraisons, setLivraisons] = useState<DonneesLivraisons | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const verrou = useRef<WakeLockSentinel | null>(null);
  // Seule une tablette qui a démarré le service donne le signe de vie surveillé par le serveur (SS-10).
  const enService = useRef(false);
  enService.current = demarre;

  const charger = useCallback(async () => {
    try {
      const [rep, repLivraisons] = await Promise.all([
        fetch(enService.current ? "/api/tablette/file?service=1" : "/api/tablette/file", { cache: "no-store" }),
        fetch("/api/tablette/livraisons", { cache: "no-store" }).catch(() => null),
      ]);
      if (rep.status === 401) return router.refresh();
      if (!rep.ok) throw new Error(String(rep.status));
      setDonnees(await rep.json());
      if (repLivraisons?.ok) setLivraisons(await repLivraisons.json());
      setDernierContact(Date.now());
      setHorsLigne(false);
    } catch {
      setHorsLigne(true);
    }
  }, [router]);

  // Signal Supabase Realtime : un message vide qui dit seulement « relis la file ».
  const [signal, setSignal] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let fermer: (() => void) | undefined;
    import("@supabase/supabase-js").then(({ createClient }) => {
      const client = createClient(supabase.url, supabase.cle, { auth: { persistSession: false } });
      const canal = client
        .channel("tablette")
        .on("broadcast", { event: "commande" }, () => charger())
        .subscribe((etat) => setSignal(etat === "SUBSCRIBED"));
      fermer = () => {
        setSignal(false);
        void client.removeChannel(canal);
      };
    });
    return () => fermer?.();
  }, [supabase, charger]);

  // Relecture au rythme proposé par le serveur (15 s en service, 60 s hors service) tant que le signal
  // Realtime passe. Sans lui, 5 s à toute heure pour ne pas rater une commande.
  const delai = signal && donnees ? donnees.relecture_s * 1000 : RELECTURE_SANS_SIGNAL_MS;
  useEffect(() => {
    charger();
  }, [charger]);
  useEffect(() => {
    const t = window.setInterval(charger, delai);
    return () => window.clearInterval(t);
  }, [charger, delai]);

  const aujourdHui = donnees ? jourGeneve(donnees.maintenant) : "";
  const avance = donnees?.reglages.impression_avance ?? IMPRESSION_AVANCE_DEFAUT;
  const rythme = donnees?.rythme ?? RYTHME_DEFAUT;
  const listes = useMemo(() => {
    const c = donnees?.commandes ?? [];
    const pourPlusTard = (x: CommandeTablette) => x.quand_type === "creneau" && x.quand_date !== null && x.quand_date > aujourdHui;
    // Acceptée, sans ticket, et l'heure d'impression pas encore venue : elle attend dans « À l'avance » (SS-11, G08).
    const imprimees = new Set((donnees?.impression.taches ?? []).map((t) => t.commande_id));
    const maintenant = donnees ? new Date(donnees.maintenant).getTime() : 0;
    const programmee = (x: CommandeTablette) =>
      x.statut === "acceptee" && x.heure_confirmee !== null && !imprimees.has(x.id) && heureImpression(x.heure_confirmee, avance[x.mode]).getTime() > maintenant;
    const parHeure = (a: CommandeTablette, b: CommandeTablette) =>
      (a.heure_confirmee ?? a.heure_proposee).localeCompare(b.heure_confirmee ?? b.heure_proposee);
    return {
      traiter: c.filter((x) => x.statut === "nouvelle" && !pourPlusTard(x)),
      // Par urgence (vague 3) : en retard d'abord, puis par heure de lancement ; prêtes et parties à la fin.
      cours: c
        .filter((x) => ACCEPTEES.includes(x.statut) && !programmee(x))
        .map((x) => ({ x, e: etatTemps(x, donnees!.maintenant, rythme) }))
        .sort((a, b) => a.e.cle - b.e.cle)
        .map(({ x }) => x),
      // Une livraison programmée n'est pas encore en cuisine : pas à donner à un livreur avant ses tickets.
      livraisons: livraisonsEnCours(c).filter((x) => !programmee(x)),
      avance: c.filter((x) => (x.statut === "nouvelle" && pourPlusTard(x)) || programmee(x)).sort(parHeure),
      plusTard: new Set(c.filter(programmee).map((x) => x.id)),
      terminees: c.filter((x) => x.statut === "terminee" || x.statut === "refusee").reverse(),
    };
  }, [donnees, aujourdHui, avance, rythme]);
  // Ce qui presse, pour chaque commande : texte, niveau et clé de tri.
  const etats = useMemo(() => new Map((donnees?.commandes ?? []).map((x) => [x.id, etatTemps(x, donnees!.maintenant, rythme)])), [donnees, rythme]);

  // Son répété toutes les 4 secondes tant qu'une commande du jour attend.
  useEffect(() => {
    if (!son || listes.traiter.length === 0) return;
    const ctx = audio.current;
    if (ctx) sonner(ctx);
    const t = window.setInterval(() => audio.current && sonner(audio.current), 4000);
    return () => window.clearInterval(t);
  }, [son, listes.traiter.length]);

  async function demarrer() {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      sonner(audio.current);
      setSon(true);
    } catch {
      // Pas de son possible : la file et le bandeau restent visibles.
    }
    try {
      verrou.current = await navigator.wakeLock?.request("screen");
    } catch {
      // Écran qui peut s'éteindre : rien de bloquant.
    }
    setDemarre(true);
  }

  // L'écran se rallume après une mise en veille : on redemande à le garder allumé.
  useEffect(() => {
    const surRetour = async () => {
      if (demarre && document.visibilityState === "visible") {
        // La veille peut suspendre le son (iPad) : on le relance avec l'écran.
        await audio.current?.resume().catch(() => undefined);
        try {
          verrou.current = await navigator.wakeLock?.request("screen");
        } catch {
          // ignoré
        }
        charger();
      }
    };
    document.addEventListener("visibilitychange", surRetour);
    return () => document.removeEventListener("visibilitychange", surRetour);
  }, [demarre, charger]);

  useEffect(() => {
    if (ordre) ordrePrecedent.current = ordre;
  });

  // Le retour d'un geste réussi reste 8 secondes en bas de l'écran, sous le doigt, puis s'efface.
  useEffect(() => {
    if (!message || message.echec) return;
    const t = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(t);
  }, [message]);

  async function agir(commande: string, corps: Record<string, unknown>) {
    setMessage(null);
    const r = await poster("/api/tablette/action", { commande, ...corps });
    if (r.statut === 401) return router.refresh();
    if (typeof r.donnees.message === "string") setMessage({ texte: r.donnees.message, echec: !r.ok });
    else if (!r.ok) setMessage({ texte: String(r.donnees.erreur ?? "L'action n'est pas passée. Réessayez."), echec: true });
    await charger();
  }

  const [confirmerDeconnexion, setConfirmerDeconnexion] = useState(false);
  async function agirLivraison(corps: Record<string, unknown>) {
    setMessage(null);
    const r = await poster("/api/tablette/livraisons", corps);
    if (r.statut === 401) return router.refresh();
    if (typeof r.donnees.message === "string") setMessage({ texte: r.donnees.message, echec: !r.ok });
    else if (!r.ok) setMessage({ texte: String(r.donnees.erreur ?? "L'action n'est pas passée. Réessayez."), echec: true });
    await charger();
  }

  async function deconnecter() {
    await poster("/api/personnel/deconnexion", {});
    router.refresh();
  }

  const pause = donnees?.reglages.pause;
  const imprimantes = (donnees?.impression.imprimantes ?? []).filter((i) => i.actif);
  const imprimantesKo = imprimantes.filter((i) => etatImprimante(i) !== "en ligne");
  const enPause = pause?.active && (!pause.jusqua || new Date(pause.jusqua).getTime() > Date.now());
  const resultats = recherche.trim() ? chercherCommandes(donnees?.commandes ?? [], recherche) : null;
  // Tableau (vague 3) : une ligne par commande pour « En cours », « À l'avance », « Terminées » et la recherche.
  // « À accepter » garde ses cartes : l'heure s'y règle avant d'accepter.
  const enLignes = resultats !== null || onglet === "cours" || onglet === "avance" || onglet === "terminees";
  const brute = resultats ?? listes[onglet];
  // Rien ne saute sous le doigt : 8 secondes après un appui sur le tableau, « En cours » garde son ordre.
  const ordre = !resultats && onglet === "cours" ? ordreStable(brute.map((c) => c.id), ordrePrecedent.current, Date.now() - dernierAppui.current < 8000) : null;
  const parId = new Map(brute.map((c) => [c.id, c]));
  const liste = ordre ? ordre.map((id) => parId.get(id)!) : brute;
  // Le détail ne s'affiche que si sa commande est dans la liste à l'écran : il revient avec son onglet et ne cache
  // jamais une recherche.
  const detail = ouverte ? (liste.find((c) => c.id === ouverte) ?? null) : null;
  const retards = listes.cours.filter((c) => etats.get(c.id)?.niveau === "retard").length;
  const aLancer = listes.cours.filter((c) => etats.get(c.id)?.niveau === "maintenant").length;
  // Refus payés dont le remboursement n'est pas passé : visibles jusqu'au remboursement, même le lendemain.
  const aRembourser = (donnees?.commandes ?? []).filter((c) => c.statut === "refusee" && c.statut_paiement === "paye");
  const nomLivreur = new Map((livraisons?.livreurs ?? []).map((l) => [l.id, l.nom]));
  const problemes = (livraisons?.livraisons ?? []).filter((l) => l.probleme && ["acceptee", "en_preparation", "partie"].includes(l.commande_statut));
  // Livreur et rang de passage de chaque commande, pour les cartes de « En cours ».
  const livraisonDe = new Map(
    (livraisons?.livraisons ?? []).map((l) => [
      l.commande_id,
      { nom: nomLivreur.get(l.livreur_id) ?? "", rang: livraisons!.livraisons.filter((x) => x.livreur_id === l.livreur_id && x.position < l.position && ["acceptee", "en_preparation", "partie"].includes(x.commande_statut)).length + 1, l },
    ]),
  );
  const ONGLETS: [Onglet, string][] = [
    ["traiter", "À accepter"],
    ["cours", "En cours"],
    ["livraisons", "Livraisons"],
    ["avance", "À l'avance"],
    ["terminees", "Terminées"],
  ];

  return (
    <div className="tablette">
      {!demarre && (
        <div className="tab-demarrer">
          <p className="tab-demarrer-titre">Bonjour {nom}</p>
          <button type="button" className="bouton-principal" onClick={demarrer}>
            Démarrer le service
          </button>
          <p>Ce bouton active le son des nouvelles commandes et garde l&apos;écran allumé.</p>
          <button type="button" className="lien" onClick={() => setDemarre(true)}>
            Continuer sans son
          </button>
        </div>
      )}

      <header className="tab-barre" ref={barre}>
        <div className="tab-etat">
          <strong>{enPause ? (pause?.jusqua ? `En pause jusqu'à ${heure(pause.jusqua)}` : "En pause") : "Commandes ouvertes"}</strong>
          <span>
            {pause?.livraisonFermee ? "Livraison fermée. " : ""}
            {donnees?.reglages.retard_minutes ? `Retard +${donnees.reglages.retard_minutes} min. ` : ""}Préparation {donnees?.reglages.preparation_minutes ?? "…"} min.{" "}
            {/* Une imprimante en panne a son bandeau : l'état ne s'écrit qu'une fois. */}
            {imprimantes.length === 0 ? "Pas d'imprimante." : imprimantesKo.length === 0 ? "Imprimantes en ligne." : ""}
          </span>
        </div>
        <div className="tab-recherche" role="search">
          <label htmlFor="tab-recherche" className="sr-only">
            Chercher une commande par numéro, nom ou téléphone
          </label>
          <input
            id="tab-recherche"
            type="search"
            placeholder="N°, nom ou tél."
            autoComplete="off"
            enterKeyHint="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="bouton-second"
          aria-expanded={reglagesOuverts}
          onClick={() => {
            // Sur téléphone, le détail ouvert couvrirait les réglages.
            if (!reglagesOuverts) setOuverte(null);
            setReglagesOuverts(!reglagesOuverts);
          }}
        >
          {reglagesOuverts ? "Fermer les réglages" : "Pause, délai, ruptures"}
        </button>
        {/* Un appui de trop pendant le service coupe la tablette : on confirme (audit du gérant, G16). */}
        {confirmerDeconnexion ? (
          <span className="boutons-ligne">
            <button type="button" className="bouton-second" onClick={deconnecter}>
              Oui, déconnecter
            </button>
            <button type="button" className="lien" onClick={() => setConfirmerDeconnexion(false)}>
              Non
            </button>
          </span>
        ) : (
          <button type="button" className="lien" onClick={() => setConfirmerDeconnexion(true)}>
            Déconnexion
          </button>
        )}
        {/* Les onglets restent en haut de l'écran quand on descend dans la liste. */}
        <nav className="tab-onglets" aria-label="Commandes">
          {ONGLETS.map(([cle, titre]) => (
            <button
              key={cle}
              type="button"
              aria-pressed={!resultats && onglet === cle}
              onClick={() => {
                setOnglet(cle);
                setRecherche("");
              }}
            >
              {titre} <span className="tab-nb">{listes[cle].length}</span>
            </button>
          ))}
        </nav>
        {listes.cours.length > 0 && (
          <p className="tab-compteur" aria-live="polite">
            {retards > 0 ? <strong className="tab-compteur-retard">{retards} en retard</strong> : <span>Aucune en retard</span>}
            {aLancer > 0 && <span>{aLancer} à lancer maintenant</span>}
          </p>
        )}
      </header>

      {horsLigne && (
        <p className="tab-alerte" role="alert">
          Pas de connexion{dernierContact ? ` depuis ${heure(new Date(dernierContact).toISOString())}` : ""}. Les nouvelles commandes ne s&apos;affichent plus.
          Appelez Jérémy si ça dure.
        </p>
      )}
      {pause?.auto && enPause && (
        <p className="tab-alerte" role="alert">
          Pause automatique : la tablette ne répondait plus pendant le service. Ouvrez les réglages et touchez « Reprendre les commandes ».
        </p>
      )}
      {aRembourser.length > 0 && (
        <p className="tab-alerte" role="alert">
          Remboursement pas passé : {aRembourser.length === 1 ? "commande" : "commandes"} {aRembourser.map((c) => c.numero).join(", ")}. Ouvrez « Terminées » et
          touchez « Rembourser ».
        </p>
      )}
      {imprimantesKo.length > 0 && (
        // Une seule ligne pour toutes les imprimantes : la file reste visible (vague 3, rush).
        <p className="tab-attente" role="alert">
          {lignesImprimantes(imprimantesKo.map((i) => ({ nom: i.nom, etat: etatImprimante(i) })))}. Les tickets attendent leur retour, « Ticket » les affiche ici.
        </p>
      )}
      {problemes.map((l) => (
        <p key={l.commande_id} className="tab-attente" role="alert">
          Livraison {l.numero} : {problemeTexte(l)} ({nomLivreur.get(l.livreur_id)}). Ouvrez « Livraisons ».
        </p>
      ))}
      {listes.traiter.length > 0 && (
        <p className="tab-attente" role="status">
          {listes.traiter.length === 1 ? "1 commande à accepter" : `${listes.traiter.length} commandes à accepter`}
          {!son ? ". Le son est coupé." : "."}
        </p>
      )}

      {reglagesOuverts && donnees && <Reglages reglages={donnees.reglages} onChange={charger} />}

      {resultats && (
        <p className="tab-recherche-info">
          {resultats.length === 0 ? "Aucune commande" : resultats.length === 1 ? "1 commande" : `${resultats.length} commandes`} pour « {recherche.trim()} ».
          <button type="button" className="bouton-second" onClick={() => setRecherche("")}>
            Effacer la recherche
          </button>
        </p>
      )}
      {donnees === null ? (
        <p className="tab-vide">Chargement…</p>
      ) : !resultats && onglet === "livraisons" ? (
        <OngletLivraisons commandes={donnees.commandes} plusTard={listes.plusTard} donnees={livraisons} agir={agirLivraison} />
      ) : enLignes ? (
        <div className={`tab-tableau${detail ? " tab-tableau-detail" : ""}`} onPointerDown={() => (dernierAppui.current = Date.now())}>
          {liste.length > 0 ? (
            <ol className="tab-tableau-liste" aria-label="Commandes, les plus pressées en haut">
              {liste.map((c) => (
                <LigneCommande
                  key={c.id}
                  c={c}
                  etat={etats.get(c.id) ?? { niveau: "calme", texte: "", cle: 0 }}
                  aujourdHui={aujourdHui}
                  livreur={livraisonDe.get(c.id) ? `${livraisonDe.get(c.id)!.nom}, arrêt ${livraisonDe.get(c.id)!.rang}` : undefined}
                  ouverte={ouverte === c.id}
                  ouvrir={() => setOuverte(ouverte === c.id ? null : c.id)}
                  agir={(corps) => agir(c.id, corps)}
                />
              ))}
            </ol>
          ) : resultats ? null : (
            <p className="tab-vide">{onglet === "cours" ? "Aucune commande en cours." : onglet === "avance" ? "Aucune commande pour plus tard." : "Rien de terminé aujourd'hui."}</p>
          )}
          {detail && (
            <aside className="tab-detail" aria-label={`Commande ${detail.numero}, détail`}>
              <div className="tab-detail-tete">
                <p>Commande {detail.numero}</p>
                <button type="button" className="bouton-second" onClick={() => setOuverte(null)}>
                  Fermer
                </button>
              </div>
              <ol className="tab-liste">
                <CarteCommande
                  key={detail.id}
                  c={detail}
                  aujourdHui={aujourdHui}
                  maintenant={donnees.maintenant}
                  avance={avance}
                  taches={(donnees.impression.taches ?? []).filter((t) => t.commande_id === detail.id)}
                  livraison={livraisonDe.get(detail.id)}
                  gerant={gerant}
                  agir={(corps) => agir(detail.id, corps)}
                  recharger={charger}
                />
              </ol>
            </aside>
          )}
        </div>
      ) : liste.length > 0 ? (
        <ol className="tab-liste">
          {liste.map((c) => (
            <CarteCommande
              key={c.id}
              c={c}
              aujourdHui={aujourdHui}
              maintenant={donnees.maintenant}
              avance={avance}
              taches={(donnees.impression.taches ?? []).filter((t) => t.commande_id === c.id)}
              livraison={livraisonDe.get(c.id)}
              gerant={gerant}
              agir={(corps) => agir(c.id, corps)}
              recharger={charger}
            />
          ))}
        </ol>
      ) : (
        <p className="tab-vide">Aucune commande à accepter.</p>
      )}

      {/* Retour de la dernière action, en bas de l'écran : visible même au fond d'une longue liste. */}
      <div className="tab-retour" aria-live="polite">
        {message && (
          <div className={`tab-retour-boite${message.echec ? " tab-retour-echec" : ""}`} role={message.echec ? "alert" : undefined}>
            <p className="tab-message">{message.texte}</p>
            <button type="button" className="bouton-second" onClick={() => setMessage(null)}>
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Commandes acceptées et pas encore terminées : leur ticket doit exister, sinon on propose de l'imprimer.
const ACCEPTEES = ["acceptee", "en_preparation", "prete", "partie"];

function decaler(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function CarteCommande({
  c,
  aujourdHui,
  maintenant,
  avance,
  taches,
  livraison,
  gerant,
  agir,
  recharger,
}: {
  c: CommandeTablette;
  aujourdHui: string;
  maintenant: string;
  avance: DelaisImpression;
  taches: Tache[];
  livraison?: { nom: string; rang: number; l: DonneesLivraisons["livraisons"][number] };
  gerant: boolean;
  agir: (corps: Record<string, unknown>) => Promise<void>;
  recharger: () => Promise<void>;
}) {
  const [tickets, setTickets] = useState<{ station: string; contenu: LigneTicket[] }[] | null>(null);

  // Le contenu des tickets n'est chargé qu'à la demande, pour garder la relecture de la file légère.
  async function ouvrirTicket() {
    const rep = await fetch(`/api/tablette/ticket?commande=${c.id}`, { cache: "no-store" }).catch(() => null);
    if (rep?.ok) setTickets(await rep.json());
  }
  // Dernière tâche de chaque poste : c'est elle qui dit où en est le ticket.
  const parPoste = (["pizza", "cuisine"] as const)
    .map((s) => taches.filter((t) => t.station === s).at(-1))
    .filter((t): t is Tache => Boolean(t));
  // Depuis le paiement en ligne, ou la création pour le comptoir : le temps passé sur la page de paiement ne compte pas.
  const attente = Math.floor((new Date(maintenant).getTime() - new Date(c.attend_depuis ?? c.cree_le).getTime()) / 60_000);
  const [panneau, setPanneau] = useState<"aucun" | "refuser" | "heure" | "manque">("aucun");
  // Décalage choisi à la main, appliqué à l'heure de base : celle-ci suit la proposition recalculée à chaque
  // vérification, pour ne jamais accepter avec une heure déjà passée.
  const [decalage, setDecalage] = useState(0);
  const base = c.statut === "nouvelle" ? c.heure_proposee : (c.heure_confirmee ?? c.heure_proposee);
  const heureChoisie = decaler(base, decalage);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  // Un autre jour qu'aujourd'hui : le jour s'écrit à côté de l'heure (revue de la tablette, D05).
  const jourDe = (iso: string) => (jourGeneve(iso) === aujourdHui ? "" : `${jourCourt(iso)} à `);
  // Commande acceptée pas encore imprimée : ses tickets sortiront à cette heure (SS-11). Déjà prête ou partie,
  // la surveillance ne l'imprime plus (commandes_a_imprimer).
  const imprimerA = c.heure_confirmee ? heureImpression(c.heure_confirmee, avance[c.mode]) : null;
  // Heure promise dépassée et pas encore prête : la commande se voit de loin (vague 3, rush).
  const retard = minutesDeRetard(c, maintenant);
  const reste = retard === null ? minutesRestantes(c, maintenant) : null;
  const ticketsPrevus =
    parPoste.length === 0 && (c.statut === "acceptee" || c.statut === "en_preparation") && imprimerA !== null && imprimerA.getTime() > new Date(maintenant).getTime();

  async function faire(corps: Record<string, unknown>) {
    setEnvoi(true);
    await agir(corps);
    setEnvoi(false);
    setPanneau("aucun");
    setDecalage(0);
  }

  const demande =
    c.quand_type === "creneau" && c.quand_date && c.quand_minutes !== null
      ? `${c.quand_date === aujourdHui ? "" : `${jourTexte(c.quand_date)}, `}${heureTexte(c.quand_minutes)}`
      : "dès que possible";
  // Manques signalés (G07) : déduits de ce qu'il reste à encaisser au comptoir.
  const deduit = c.deduit_centimes ?? 0;
  const paiement =
    c.statut_paiement === "paye"
      ? `Payée en ligne ${prixChf(c.total_centimes)}`
      : c.statut_paiement === "a_encaisser_retrait"
        ? `À encaisser au comptoir ${prixChf(c.total_centimes - deduit)}`
        : c.statut_paiement === "encaisse"
          ? `Encaissée ${prixChf(c.total_centimes)}`
          : c.statut_paiement === "rembourse"
            ? `Remboursée ${prixChf(c.total_centimes)}`
            : prixChf(c.total_centimes);
  const STATUT: Record<string, string> = {
    nouvelle: "À accepter",
    acceptee: "Acceptée",
    en_preparation: "En préparation",
    prete: "Prête au comptoir",
    partie: "Partie",
    terminee: c.motif === MOTIF_CLIENT_ABSENT ? "Non remise, client absent (le gérant décide d'un remboursement)" : c.mode === "livraison" ? "Livrée" : "Retirée",
    refusee: "Refusée",
  };

  const reglageHeure = (
    <div className="tab-heure">
      <p className="tab-heure-valeur" aria-live="polite">
        {heure(heureChoisie)}
      </p>
      <div className="tab-heure-boutons">
        {[-5, 5, 15].map((m) => (
          <button key={m} type="button" className="bouton-second" onClick={() => setDecalage((d) => d + m)}>
            {m > 0 ? `+${m}` : `−${-m}`} min
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <li className={`tab-commande tab-${c.statut}${retard !== null ? " tab-en-retard" : ""}`}>
      <div className="tab-tete">
        <p className="tab-num">{c.numero}</p>
        <div>
          <p className="tab-mode">
            <strong>{c.mode === "livraison" ? "Livraison" : "À emporter"}</strong>, demandée {demande}
          </p>
          <p className="tab-meta">
            Reçue {jourGeneve(c.cree_le) === aujourdHui ? "" : `le ${jourTexte(jourGeneve(c.cree_le))} `}à {heure(c.cree_le)}. {STATUT[c.statut] ?? c.statut}
            {c.heure_confirmee ? ` pour ${jourDe(c.heure_confirmee)}${heure(c.heure_confirmee)}` : ""}.
            {c.statut === "nouvelle" && attente >= 3 && !(c.quand_date && c.quand_date > aujourdHui) && (
              <strong className="tab-attend"> Attend depuis {attente} min.</strong>
            )}
          </p>
        </div>
        {/* Une fois acceptée, l'heure promise se lit à un mètre (audit design, D05, maquette de la tablette). */}
        {c.heure_confirmee && ACCEPTEES.includes(c.statut) && (
          <p className="tab-promise">
            <span>Heure annoncée au client</span>
            {jourDe(c.heure_confirmee) && <strong className="tab-promise-jour">{jourCourt(c.heure_confirmee)}</strong>}
            {heure(c.heure_confirmee)}
            {retard !== null && <em className="tab-retard">En retard de {retard} min</em>}
            {reste !== null && <em className="tab-reste">{reste === 0 ? "maintenant" : `dans ${reste} min`}</em>}
          </p>
        )}
      </div>

      {c.avertissement && c.statut === "nouvelle" && <p className="tab-avertissement">{c.avertissement}</p>}

      <div className="tab-corps">
        <ul className="tab-lignes">
          {c.lignes.map((l, i) => (
            <li key={i}>
              <span className="tab-ligne-tete">
                <span className="tab-ligne-nom">
                  {l.qte} × {l.nom}
                </span>
                <span className="tab-poste">{l.station === "pizza" ? "Pizza" : "Cuisine"}</span>
              </span>
              {l.details.length > 0 && (
                <ul className="tab-opts">
                  {l.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="tab-client">
          <p>
            <strong>
              {c.client_prenom} {c.client_nom}
            </strong>
            <br />
            <a href={`tel:${c.client_telephone.replace(/[^+\d]/g, "")}`}>{c.client_telephone}</a>
          </p>
          {c.mode === "livraison" && c.adresse && (
            <p>
              {c.adresse.rue} {c.adresse.numero}, {c.adresse.npa} {c.adresse.localite}
              {c.details_livraison && (
                <>
                  <br />
                  {[c.details_livraison.etage && `étage ${c.details_livraison.etage}`, `sonnette ${c.details_livraison.sonnette}`, c.details_livraison.code && `code ${c.details_livraison.code}`]
                    .filter(Boolean)
                    .join(", ")}
                  {c.details_livraison.instructions && (
                    <>
                      <br />« {c.details_livraison.instructions} »
                    </>
                  )}
                </>
              )}
            </p>
          )}
          {c.mode === "livraison" && ACCEPTEES.includes(c.statut) && (
            <p>
              {livraison ? (
                <>
                  Livreur : <strong>{livraison.nom}</strong>, arrêt {livraison.rang}.
                  {livraison.l.probleme && <strong className="tab-attend"> Problème : {problemeTexte(livraison.l)}.</strong>}
                </>
              ) : (
                "Pas encore de livreur (onglet « Livraisons »)."
              )}
            </p>
          )}
          <p className="tab-paiement">{paiement}</p>
          {c.manques && c.manques.length > 0 && (
            <p className="tab-manque">
              Manque : {c.manques.join(" ; ")}. {prixChf(deduit).replace(" ", "\u00a0")} {c.statut_paiement === "a_encaisser_retrait" ? "déduits" : "remboursés"}.
            </p>
          )}
          {c.motif && c.statut === "refusee" && <p>{c.motif}</p>}
        </div>
      </div>

      {c.statut === "nouvelle" && panneau !== "refuser" && (
        <div className="tab-actions">
          {reglageHeure}
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "accepter", heure: heureChoisie, de: c.statut })}>
            Accepter pour {jourDe(heureChoisie)}
            {heure(heureChoisie)}
          </button>
          <button type="button" className="bouton-second" onClick={() => setPanneau("refuser")}>
            Refuser
          </button>
        </div>
      )}

      {panneau === "refuser" && (
        <div className="tab-actions tab-refus">
          <p className="aide-forte">Pourquoi ? Le client reçoit ce motif par e-mail.</p>
          <div className="tab-motifs">
            {MOTIFS_REFUS.map(([texte, m]) => (
              <button key={m} type="button" className="bouton-second" aria-pressed={motif === m} onClick={() => setMotif(m)}>
                {texte}
              </button>
            ))}
          </div>
          <div className="champ">
            <label htmlFor={`motif-${c.id}`}>Autre motif</label>
            <input id={`motif-${c.id}`} maxLength={200} value={MOTIFS.includes(motif) ? "" : motif} onChange={(e) => setMotif(e.target.value)} />
          </div>
          <button type="button" className="bouton-principal" disabled={envoi || motif.trim().length < 3} onClick={() => faire({ action: "refuser", motif, de: c.statut })}>
            {c.statut === "nouvelle"
              ? c.statut_paiement === "paye"
                ? `Refuser et rembourser ${prixChf(c.total_centimes)}`
                : "Refuser la commande"
              : c.statut_paiement === "paye"
                ? `Annuler et rembourser ${prixChf(c.total_centimes)}`
                : "Annuler la commande"}
          </button>
          <button type="button" className="bouton-second" onClick={() => setPanneau("aucun")}>
            Fermer
          </button>
        </div>
      )}

      {["acceptee", "en_preparation", "prete", "partie"].includes(c.statut) && panneau === "aucun" && (
        <div className="tab-actions tab-actions-ligne">
          {c.statut === "acceptee" && (
            <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "statut", vers: "en_preparation", de: c.statut })}>
              En préparation
            </button>
          )}
          {(c.statut === "acceptee" || c.statut === "en_preparation") && (
            <button
              type="button"
              className="bouton-principal"
              disabled={envoi}
              onClick={() => faire({ action: "statut", vers: c.mode === "livraison" ? "partie" : "prete", de: c.statut })}
            >
              {c.mode === "livraison" ? "Partie en livraison" : "Prête au comptoir"}
            </button>
          )}
          {c.statut === "prete" && c.statut_paiement === "a_encaisser_retrait" ? (
            // Retrait payé au comptoir : un seul geste, pour ne jamais oublier l'encaissement (audit du gérant, G01).
            <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "retiree_payee" })}>
              Retirée et payée
            </button>
          ) : (
            (c.statut === "prete" || c.statut === "partie") && (
              <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "statut", vers: "terminee", de: c.statut })}>
                {c.mode === "livraison" ? "Livrée" : "Retirée"}
              </button>
            )
          )}
          {c.statut_paiement === "a_encaisser_retrait" && c.statut !== "prete" && (
            <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "encaisser" })}>
              Encaissée
            </button>
          )}
          <button type="button" className="bouton-second" onClick={() => setPanneau("heure")}>
            Changer l&apos;heure
          </button>
          {["paye", "encaisse", "a_encaisser_retrait"].includes(c.statut_paiement) && (
            <button type="button" className="bouton-second" onClick={() => setPanneau("manque")}>
              Il manque…
            </button>
          )}
          {c.statut === "partie" && !gerant && (
            // Livraison partie : l'annuler rembourse tout, donc gérant seulement (audit de sécurité 2, S2-01).
            // Client absent : onglet Livraisons, sans remboursement.
            <p className="aide">Seul le gérant peut annuler une livraison partie.</p>
          )}
          {c.statut !== "prete" && (c.statut !== "partie" || gerant) && (
            // À l'écart des autres boutons : elle annule la commande (et rembourse si elle est payée). Une
            // livraison partie s'annule aussi (adresse introuvable), par le gérant : le livreur le lit.
            <>
              <span className="tab-saut" aria-hidden="true" />
              <button type="button" className="bouton-second tab-annuler" onClick={() => setPanneau("refuser")}>
                Annuler la commande
              </button>
            </>
          )}
        </div>
      )}

      {c.statut === "terminee" && c.statut_paiement === "a_encaisser_retrait" && (
        <div className="tab-actions">
          <p className="aide-forte">Pas encore notée comme encaissée.</p>
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "encaisser" })}>
            Encaissée
          </button>
        </div>
      )}

      {panneau === "manque" && (
        <PanneauManque
          c={c}
          fermer={async () => {
            setPanneau("aucun");
            await recharger();
          }}
        />
      )}

      {panneau === "heure" && (
        <div className="tab-actions">
          {reglageHeure}
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "heure", heure: heureChoisie })}>
            Changer pour {heure(heureChoisie)}
          </button>
          <button type="button" className="bouton-second" onClick={() => setPanneau("aucun")}>
            Fermer
          </button>
        </div>
      )}

      {(parPoste.length > 0 || ACCEPTEES.includes(c.statut)) && (
        <div className="tab-impression">
          <p>
            {ticketsPrevus && imprimerA
              ? `Tickets prévus ${momentTexte(imprimerA, maintenant)}.`
              : parPoste.length === 0
                ? "Ticket non créé."
                : `${parPoste.map((t) => `Ticket ${t.station} : ${ETAT_TACHE[t.etat]}${t.etat === "echec" && t.derniere_erreur ? ` (${t.derniere_erreur})` : ""}`).join(". ")}.`}
          </p>
          <div className="boutons-ligne">
            {parPoste.length > 0 && (
              <button type="button" className="bouton-second" onClick={ouvrirTicket}>
                Ticket
              </button>
            )}
            {c.statut !== "refusee" && (
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "reimprimer" })}>
                {parPoste.length === 0 ? "Imprimer maintenant" : "Réimprimer"}
              </button>
            )}
            {c.statut !== "refusee" &&
              parPoste.length > 1 &&
              parPoste.map((t) => (
                <button key={t.station} type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "reimprimer", station: t.station })}>
                  Réimprimer {t.station === "pizza" ? "Pizza" : "Cuisine"}
                </button>
              ))}
          </div>
        </div>
      )}
      {tickets && <TicketSecours tickets={tickets} fermer={() => setTickets(null)} />}

      {c.statut === "refusee" && c.statut_paiement === "paye" && (
        <div className="tab-actions">
          <p className="aide-forte">Le remboursement n&apos;est pas passé.</p>
          <button type="button" className="bouton-principal" disabled={envoi} onClick={() => faire({ action: "rembourser" })}>
            Rembourser {prixChf(c.total_centimes)}
          </button>
        </div>
      )}
    </li>
  );
}

// Un plat ou un supplément manque (audit du gérant, G07) : on coche ce qui manque, la base calcule le montant,
// puis on confirme. Le client est prévenu par e-mail. Payée en ligne : remboursé ; au comptoir : déduit.
function PanneauManque({ c, fermer }: { c: CommandeTablette; fermer: () => Promise<void> }) {
  // Plats entiers : quantité manquante par ligne. Suppléments : « ligne|groupe|nom ».
  const [plats, setPlats] = useState<Record<number, number>>({});
  const [options, setOptions] = useState<string[]>([]);
  const [estimation, setEstimation] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Même clé jusqu'à ce que le geste aboutisse : un double appui ne rembourse pas deux fois.
  const [cle, setCle] = useState(nouvelleCle);

  const elements = [
    ...Object.entries(plats)
      .filter(([, q]) => q > 0)
      .map(([ligne, qte]) => ({ ligne: Number(ligne), qte })),
    ...options.map((o) => {
      const [ligne, groupe, nom] = o.split("|");
      return { ligne: Number(ligne), groupe, nom };
    }),
  ];

  async function envoyer(confirmer: boolean) {
    setEnvoi(true);
    const r = await poster("/api/tablette/manque", { commande: c.id, elements, cle, confirmer });
    const texte = String(r.donnees.message ?? r.donnees.erreur ?? "Pas passé. Réessayez.");
    if (!confirmer) setEstimation(r.ok ? texte : null);
    if (confirmer || !r.ok) setResultat({ ok: r.ok, texte });
    if (confirmer && (r.ok || r.statut === 409)) setCle(nouvelleCle());
    setEnvoi(false);
  }

  function changer(f: () => void) {
    f();
    setEstimation(null);
    setResultat(null);
  }

  if (resultat?.ok) {
    return (
      <div className="tab-actions">
        <p className="aide-forte" role="status">
          {resultat.texte}
        </p>
        <button type="button" className="bouton-principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    );
  }

  return (
    <div className="tab-actions tab-refus">
      <p className="aide-forte">Qu&apos;est-ce qui manque ? Le client est prévenu par e-mail.</p>
      <div className="tab-motifs">
        {c.lignes.map((l, i) => {
          const q = plats[i] ?? 0;
          return (
            <span key={`p${i}`} className="boutons-ligne">
              <button
                type="button"
                className="bouton-second"
                aria-pressed={q > 0}
                onClick={() => changer(() => setPlats({ ...plats, [i]: q > 0 ? 0 : l.qte }))}
              >
                {q > 0 ? q : l.qte} × {l.nom}
              </button>
              {q > 0 && l.qte > 1 && (
                <>
                  <button type="button" className="bouton-second" aria-label={`Une ${l.nom} de moins`} disabled={q <= 1} onClick={() => changer(() => setPlats({ ...plats, [i]: q - 1 }))}>
                    −1
                  </button>
                  <button type="button" className="bouton-second" aria-label={`Une ${l.nom} de plus`} disabled={q >= l.qte} onClick={() => changer(() => setPlats({ ...plats, [i]: q + 1 }))}>
                    +1
                  </button>
                </>
              )}
            </span>
          );
        })}
        {c.lignes.flatMap((l, i) =>
          Object.entries(l.choix ?? {}).flatMap(([groupe, noms]) =>
            // Seulement les suppléments payants (« + » sur la carte de commande), pas un choix obligatoire comme les pâtes.
            noms.filter((nom) => l.details.includes(`+ ${nom}`)).map((nom) => {
              const k = `${i}|${groupe}|${nom}`;
              const pris = options.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className="bouton-second"
                  aria-pressed={pris}
                  disabled={(plats[i] ?? 0) >= l.qte}
                  onClick={() => changer(() => setOptions(pris ? options.filter((x) => x !== k) : [...options, k]))}
                >
                  {nom} sur {l.nom}
                </button>
              );
            }),
          ),
        )}
      </div>
      {estimation && <p className="aide-forte">{estimation}</p>}
      {resultat && !resultat.ok && (
        <p className="panier-alerte" role="alert">
          {resultat.texte}
        </p>
      )}
      {estimation ? (
        <button type="button" className="bouton-principal" disabled={envoi} onClick={() => envoyer(true)}>
          Confirmer et prévenir le client
        </button>
      ) : (
        <button type="button" className="bouton-principal" disabled={envoi || elements.length === 0} onClick={() => envoyer(false)}>
          Calculer le montant
        </button>
      )}
      <button type="button" className="bouton-second" onClick={fermer}>
        Fermer
      </button>
    </div>
  );
}
