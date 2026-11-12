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
  // Rythme de relecture proposé par le serveur : 15 s pendant le service, 60 s hors service.
  relecture_s: number;
};

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

type Onglet = "traiter" | "cours" | "avance" | "terminees";

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

export function Tablette({ nom, supabase }: { nom: string; supabase: { url: string; cle: string } | null }) {
  const router = useRouter();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [dernierContact, setDernierContact] = useState<number | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>("traiter");
  const [demarre, setDemarre] = useState(false);
  // Vrai seulement si le navigateur a accepté de jouer le son.
  const [son, setSon] = useState(false);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const verrou = useRef<WakeLockSentinel | null>(null);
  // Seule une tablette qui a démarré le service donne le signe de vie surveillé par le serveur (SS-10).
  const enService = useRef(false);
  enService.current = demarre;

  const charger = useCallback(async () => {
    try {
      const rep = await fetch(enService.current ? "/api/tablette/file?service=1" : "/api/tablette/file", { cache: "no-store" });
      if (rep.status === 401) return router.refresh();
      if (!rep.ok) throw new Error(String(rep.status));
      setDonnees(await rep.json());
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
      cours: c.filter((x) => ACCEPTEES.includes(x.statut) && !programmee(x)).sort(parHeure),
      avance: c.filter((x) => (x.statut === "nouvelle" && pourPlusTard(x)) || programmee(x)).sort(parHeure),
      terminees: c.filter((x) => x.statut === "terminee" || x.statut === "refusee").reverse(),
    };
  }, [donnees, aujourdHui, avance]);

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

  async function agir(commande: string, corps: Record<string, unknown>) {
    setMessage(null);
    const r = await poster("/api/tablette/action", { commande, ...corps });
    if (r.statut === 401) return router.refresh();
    if (typeof r.donnees.message === "string") setMessage(r.donnees.message);
    else if (!r.ok) setMessage(String(r.donnees.erreur ?? "L'action n'est pas passée. Réessayez."));
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
  const liste = listes[onglet];
  // Refus payés dont le remboursement n'est pas passé : visibles jusqu'au remboursement, même le lendemain.
  const aRembourser = (donnees?.commandes ?? []).filter((c) => c.statut === "refusee" && c.statut_paiement === "paye");
  const ONGLETS: [Onglet, string][] = [
    ["traiter", "À accepter"],
    ["cours", "En cours"],
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

      <header className="tab-barre">
        <div className="tab-etat">
          <strong>{enPause ? (pause?.jusqua ? `En pause jusqu'à ${heure(pause.jusqua)}` : "En pause") : "Commandes ouvertes"}</strong>
          <span>
            {pause?.livraisonFermee ? "Livraison fermée. " : ""}
            {donnees?.reglages.retard_minutes ? `Retard +${donnees.reglages.retard_minutes} min. ` : ""}Préparation {donnees?.reglages.preparation_minutes ?? "…"} min.{" "}
            {imprimantes.length === 0 ? "Pas d'imprimante." : imprimantes.map((i) => `${i.nom} : ${etatImprimante(i)}`).join(". ") + "."}
          </span>
        </div>
        <button type="button" className="bouton-second" aria-expanded={reglagesOuverts} onClick={() => setReglagesOuverts((v) => !v)}>
          {reglagesOuverts ? "Fermer les réglages" : "Pause, délai, ruptures"}
        </button>
        <button type="button" className="lien" onClick={deconnecter}>
          Déconnexion
        </button>
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
      {imprimantesKo.map((i) => (
        <p key={i.id} className="tab-attente" role="alert">
          {i.nom} : {etatImprimante(i)}. Les tickets attendent et sortiront à son retour. Touchez « Ticket » sur une commande pour l&apos;afficher ici.
        </p>
      ))}
      {listes.traiter.length > 0 && (
        <p className="tab-attente" role="status">
          {listes.traiter.length === 1 ? "1 commande à accepter" : `${listes.traiter.length} commandes à accepter`}
          {!son ? ". Le son est coupé." : ""}
        </p>
      )}
      {message && (
        <p className="tab-message" role="status">
          {message}
        </p>
      )}

      {reglagesOuverts && donnees && <Reglages reglages={donnees.reglages} onChange={charger} />}

      <nav className="tab-onglets" aria-label="Commandes">
        {ONGLETS.map(([cle, titre]) => (
          <button key={cle} type="button" aria-pressed={onglet === cle} onClick={() => setOnglet(cle)}>
            {titre} <span className="tab-nb">{listes[cle].length}</span>
          </button>
        ))}
      </nav>

      {donnees === null ? (
        <p className="tab-vide">Chargement…</p>
      ) : liste.length === 0 ? (
        <p className="tab-vide">
          {onglet === "traiter" ? "Aucune commande à accepter." : onglet === "cours" ? "Aucune commande en cours." : onglet === "avance" ? "Aucune commande pour plus tard." : "Rien de terminé aujourd'hui."}
        </p>
      ) : (
        <ol className="tab-liste">
          {liste.map((c) => (
            <CarteCommande
              key={c.id}
              c={c}
              aujourdHui={aujourdHui}
              maintenant={donnees.maintenant}
              avance={avance}
              taches={(donnees.impression.taches ?? []).filter((t) => t.commande_id === c.id)}
              agir={(corps) => agir(c.id, corps)}
            />
          ))}
        </ol>
      )}
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
  agir,
}: {
  c: CommandeTablette;
  aujourdHui: string;
  maintenant: string;
  avance: DelaisImpression;
  taches: Tache[];
  agir: (corps: Record<string, unknown>) => Promise<void>;
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
  const [panneau, setPanneau] = useState<"aucun" | "refuser" | "heure">("aucun");
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
  const paiement =
    c.statut_paiement === "paye"
      ? `Payée en ligne ${prixChf(c.total_centimes)}`
      : c.statut_paiement === "a_encaisser_retrait"
        ? `À encaisser au comptoir ${prixChf(c.total_centimes)}`
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
    terminee: c.mode === "livraison" ? "Livrée" : "Retirée",
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
    <li className={`tab-commande tab-${c.statut}`}>
      <div className="tab-tete">
        <p className="tab-num">{c.numero}</p>
        <div>
          <p className="tab-mode">
            <strong>{c.mode === "livraison" ? "Livraison" : "À emporter"}</strong>, demandée {demande}
          </p>
          <p className="tab-meta">
            Reçue {jourGeneve(c.cree_le) === aujourdHui ? "" : `le ${jourTexte(jourGeneve(c.cree_le))} `}à {heure(c.cree_le)}. {STATUT[c.statut] ?? c.statut}
            {c.heure_confirmee ? ` pour ${jourDe(c.heure_confirmee)}${heure(c.heure_confirmee)}` : ""}.
            {c.statut === "nouvelle" && attente >= 3 && <strong className="tab-attend"> Attend depuis {attente} min.</strong>}
          </p>
        </div>
        {/* Une fois acceptée, l'heure promise se lit à un mètre (audit design, D05, maquette de la tablette). */}
        {c.heure_confirmee && ACCEPTEES.includes(c.statut) && (
          <p className="tab-promise">
            <span>Heure annoncée au client</span>
            {jourDe(c.heure_confirmee) && <strong className="tab-promise-jour">{jourCourt(c.heure_confirmee)}</strong>}
            {heure(c.heure_confirmee)}
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
          <p className="tab-paiement">{paiement}</p>
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
          {c.statut !== "prete" && c.statut !== "partie" && (
            // À l'écart des autres boutons : elle annule la commande (et rembourse si elle est payée).
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
                  Réimprimer {t.station}
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
