"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lireChoix } from "@/lib/choix";
import type { Mode, Quand } from "@/lib/service";
import { LIMITES, memeLigne, type LignePanier, type Totaux } from "@/lib/panier";

// Panier gardé dans le navigateur (localStorage), comme le choix du mode : rien dans l'URL.
const CLE = "laferme.panier.v1";
const DUREE_VIE_MS = 24 * 60 * 60 * 1000;

// expire : le panier gardé avait plus de 24 h. Il n'est plus servi, mais on le dit une fois (CM-15).
function lireStockage(): { lignes: LignePanier[]; expire: boolean } {
  try {
    const brut = window.localStorage.getItem(CLE);
    if (!brut) return { lignes: [], expire: false };
    const p = JSON.parse(brut) as { lignes?: LignePanier[]; le?: number };
    if (!Array.isArray(p.lignes)) return { lignes: [], expire: false };
    if (Date.now() - (p.le ?? 0) > DUREE_VIE_MS) return { lignes: [], expire: p.lignes.length > 0 };
    return { lignes: p.lignes.slice(0, LIMITES.lignes), expire: false };
  } catch {
    return { lignes: [], expire: false };
  }
}

function lire(): LignePanier[] {
  return lireStockage().lignes;
}

function ecrire(lignes: LignePanier[]) {
  try {
    window.localStorage.setItem(CLE, JSON.stringify({ lignes, le: Date.now() }));
  } catch {
    // Stockage bloqué : le panier vit le temps de la page.
  }
}

export type LigneRetiree = { ligne: LignePanier; index: number };

export function usePanier() {
  const [lignes, setLignes] = useState<LignePanier[]>([]);
  const [charge, setCharge] = useState(false);
  const [expire, setExpire] = useState(false);
  // Dernière ligne retirée par « − », pour « Annuler » (CM-23). Oubliée au geste suivant.
  const [retiree, setRetiree] = useState<LigneRetiree | null>(null);
  const courant = useRef<LignePanier[]>([]);
  courant.current = lignes;

  useEffect(() => {
    const s = lireStockage();
    setLignes(s.lignes);
    setExpire(s.expire);
    setCharge(true);
    // Un autre onglet a changé le panier.
    const surStockage = (e: StorageEvent) => e.key === CLE && setLignes(lire());
    window.addEventListener("storage", surStockage);
    return () => window.removeEventListener("storage", surStockage);
  }, []);

  const changer = useCallback((f: (l: LignePanier[]) => LignePanier[]) => {
    setExpire(false);
    setLignes((avant) => {
      const apres = f(avant);
      ecrire(apres);
      return apres;
    });
  }, []);

  const ajouter = useCallback(
    (l: LignePanier) => {
      setRetiree(null);
      changer((avant) => {
        const i = avant.findIndex((x) => memeLigne(x, l));
        if (i === -1) return [...avant, l].slice(0, LIMITES.lignes);
        return avant.map((x, j) => (j === i ? { ...x, qte: Math.min(LIMITES.quantite, x.qte + l.qte) } : x));
      });
    },
    [changer],
  );
  const quantite = useCallback(
    (i: number, delta: number) => {
      const l = courant.current[i];
      setRetiree(l && l.qte + delta < 1 ? { ligne: l, index: i } : null);
      changer((avant) =>
        avant.flatMap((x, j) => (j !== i ? [x] : x.qte + delta < 1 ? [] : [{ ...x, qte: Math.min(LIMITES.quantite, x.qte + delta) }])),
      );
    },
    [changer],
  );
  // Ligne modifiée depuis sa fiche (options, retraits, note, quantité) : elle garde sa place. Devenue
  // identique à une autre ligne, les deux se rejoignent.
  const remplacer = useCallback(
    (i: number, l: LignePanier) => {
      setRetiree(null);
      changer((avant) => {
        if (!avant[i]) return avant;
        const autre = avant.findIndex((x, j) => j !== i && memeLigne(x, l));
        if (autre === -1) return avant.map((x, j) => (j === i ? l : x));
        return avant.flatMap((x, j) => (j === i ? [] : j === autre ? [{ ...x, qte: Math.min(LIMITES.quantite, x.qte + l.qte) }] : [x]));
      });
    },
    [changer],
  );
  // La ligne revient à sa place, avec ses options et sa note.
  const annulerRetrait = useCallback(() => {
    if (!retiree) return;
    setRetiree(null);
    changer((avant) => {
      const a = [...avant];
      a.splice(Math.min(retiree.index, a.length), 0, retiree.ligne);
      return a.slice(0, LIMITES.lignes);
    });
  }, [retiree, changer]);
  // Message d'expiration montré : il ne revient pas au prochain chargement.
  const oublierExpire = useCallback(() => {
    try {
      if (lireStockage().expire) window.localStorage.removeItem(CLE);
    } catch {
      // Stockage bloqué : rien à oublier.
    }
  }, []);

  return { lignes, charge, ajouter, quantite, remplacer, expire, retiree, annulerRetrait, oublierExpire };
}

export type SuiviPanier = Pick<ReturnType<typeof usePanier>, "expire" | "retiree" | "annulerRetrait" | "oublierExpire">;

export type ReponsePanier = Totaux & {
  message_quand: string | null;
  erreur?: string;
  plafond_comptoir_centimes?: number | null;
  // Créneau rempli par d'autres clients depuis le choix de l'heure (vague 3).
  creneau_complet?: boolean;
};

// État du calcul pour l'écran : rien n'est laissé gris sans raison (vague 3, client-commande).
// lent : la réponse tarde (plus de 1,2 s), on le dit. echec : réseau coupé ou serveur muet, on propose de réessayer.
export type CalculPanier = { reponse: ReponsePanier | null; lent: boolean; echec: boolean; relancer: () => void };

const DELAI_LENT_MS = 1200;

// Allergie de la commande en cours : gardée dans l'onglet (rechargement, paiement annulé), effacée une fois
// la commande passée. Jamais dans le compte ni dans le localStorage (donnée de santé, nLPD art. 5).
export const CLE_ALLERGIE = "laferme.allergie";

// Créneau pour lequel ce navigateur a déjà envoyé une commande (onglet seulement) : voir /api/panier.
const CLE_PLACE = "laferme.place-envoyee";
const place = (mode: Mode, quand: Quand) => (quand.type === "creneau" ? `${mode} ${quand.date} ${quand.minutes}` : null);

export function noterPlaceEnvoyee(mode: Mode, quand: Quand): void {
  const p = place(mode, quand);
  try {
    if (p) window.sessionStorage.setItem(CLE_PLACE, p);
  } catch {
    // Stockage bloqué : au pire, le créneau paraît complet et le client en choisit un autre.
  }
}

function placeEnvoyee(mode: Mode, quand: Quand): boolean {
  const p = place(mode, quand);
  try {
    return p !== null && window.sessionStorage.getItem(CLE_PLACE) === p;
  } catch {
    return false;
  }
}

// Montants calculés par le serveur, redemandés 300 ms après chaque changement du panier.
// Une réponse ne sert que pour le contenu exact qu'elle a calculé : sinon le navigateur affiche son propre calcul.
// relance : un nombre qui change pour redemander le calcul sans changement du panier (plat épuisé
// entre-temps, refusé au paiement). Redemandé aussi quand le client revient sur l'onglet ou que le réseau
// revient : entre-temps, un plat a pu s'épuiser, le restaurant se mettre en pause ou le créneau se remplir.
export function useCalculPanier(lignes: LignePanier[], actif: boolean, relance = 0): CalculPanier {
  const [etat, setEtat] = useState<{ cle: string; reponse: ReponsePanier } | null>(null);
  const [attente, setAttente] = useState<{ numero: number; lent: boolean; echec: boolean } | null>(null);
  const [retour, setRetour] = useState(0);
  const cle = JSON.stringify(lignes);
  const dernier = useRef(0);
  const relancer = useCallback(() => setRetour((n) => n + 1), []);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") relancer();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", relancer);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", relancer);
    };
  }, [relancer]);

  useEffect(() => {
    if (!actif) return;
    const choix = lireChoix();
    if (!choix || lignes.length === 0) return;
    const numero = ++dernier.current;
    const ctrl = new AbortController();
    setAttente({ numero, lent: false, echec: false });
    const lent = window.setTimeout(() => setAttente((a) => (a?.numero === numero ? { ...a, lent: true } : a)), DELAI_LENT_MS);
    const t = window.setTimeout(() => {
      fetch("/api/panier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lignes,
          mode: choix.mode,
          adresse: choix.adresse,
          quand: choix.quand,
          heure: choix.heureSimulee,
          placeTenue: placeEnvoyee(choix.mode, choix.quand),
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((r: ReponsePanier) => {
          if (numero !== dernier.current) return;
          window.clearTimeout(lent);
          setEtat({ cle: JSON.stringify(lignes), reponse: r });
          setAttente(null);
        })
        .catch(() => {
          if (numero !== dernier.current || ctrl.signal.aborted) return;
          window.clearTimeout(lent);
          setAttente({ numero, lent: false, echec: true });
        });
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
      window.clearTimeout(lent);
    };
  }, [lignes, actif, relance, retour]);

  const reponse = etat && etat.cle === cle ? etat.reponse : null;
  return { reponse, lent: !reponse && Boolean(attente?.lent), echec: !reponse && Boolean(attente?.echec), relancer };
}

// Après une commande passée : le panier repart vide (et la clé de commande avec lui). Seulement dans
// l'onglet qui a passé la commande, reconnu à sa clé : ouvrir un lien de suivi transmis ne vide rien.
export function viderPanier(): void {
  try {
    if (!window.sessionStorage.getItem("laferme.cle-commande")) return;
    window.localStorage.removeItem(CLE);
    window.sessionStorage.removeItem("laferme.cle-commande");
    window.sessionStorage.removeItem(CLE_PLACE);
    window.sessionStorage.removeItem(CLE_ALLERGIE);
  } catch {
    // Stockage bloqué : rien à vider.
  }
}

// « Recommander la même chose » : le panier prend les lignes contrôlées par le serveur.
export function remplacerPanier(lignes: LignePanier[]): void {
  ecrire(lignes.slice(0, LIMITES.lignes));
}

// Le panier dit combien de plats sont revenus, une fois, quand on y va tout de suite (CM-19).
const CLE_REMIS = "laferme.remis";
export function annoncerPlatsRemis(lignes: LignePanier[]): void {
  try {
    window.sessionStorage.setItem(CLE_REMIS, String(lignes.reduce((n, x) => n + x.qte, 0)));
  } catch {
    // Stockage bloqué : pas de message.
  }
}

export function lirePlatsRemis(): number {
  try {
    const n = Number(window.sessionStorage.getItem(CLE_REMIS));
    window.sessionStorage.removeItem(CLE_REMIS);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function panierVide(): boolean {
  return lire().length === 0;
}
