"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lireChoix } from "@/lib/choix";
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

  return { lignes, charge, ajouter, quantite, expire, retiree, annulerRetrait, oublierExpire };
}

export type SuiviPanier = Pick<ReturnType<typeof usePanier>, "expire" | "retiree" | "annulerRetrait" | "oublierExpire">;

export type ReponsePanier = Totaux & { message_quand: string | null; erreur?: string; plafond_comptoir_centimes?: number | null };

// Montants calculés par le serveur, redemandés 300 ms après chaque changement du panier.
// Une réponse ne sert que pour le contenu exact qu'elle a calculé : sinon le navigateur affiche son propre calcul.
export function usePrixServeur(lignes: LignePanier[], actif: boolean): ReponsePanier | null {
  const [etat, setEtat] = useState<{ cle: string; reponse: ReponsePanier } | null>(null);
  const cle = JSON.stringify(lignes);
  const dernier = useRef(0);

  useEffect(() => {
    if (!actif) return;
    const choix = lireChoix();
    if (!choix || lignes.length === 0) return;
    const numero = ++dernier.current;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch("/api/panier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes, mode: choix.mode, adresse: choix.adresse, quand: choix.quand, heure: choix.heureSimulee }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((r: ReponsePanier) => {
          if (numero === dernier.current) setEtat({ cle: JSON.stringify(lignes), reponse: r });
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [lignes, actif]);

  return etat && etat.cle === cle ? etat.reponse : null;
}

// Après une commande passée : le panier repart vide (et la clé de commande avec lui). Seulement dans
// l'onglet qui a passé la commande, reconnu à sa clé : ouvrir un lien de suivi transmis ne vide rien.
export function viderPanier(): void {
  try {
    if (!window.sessionStorage.getItem("laferme.cle-commande")) return;
    window.localStorage.removeItem(CLE);
    window.sessionStorage.removeItem("laferme.cle-commande");
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
