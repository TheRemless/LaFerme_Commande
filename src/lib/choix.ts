// Choix du client (mode, adresse, créneau), gardé dans le navigateur seulement, jamais dans l'URL.
// La saisie de l'adresse part vers geo.admin.ch pour l'autocomplétion, rien d'autre ne sort.
// Le serveur recontrôle tout au paiement.
import type { Adresse, Details } from "@/lib/adresse";
import type { Mode, Quand } from "@/lib/service";

export type { Quand };

export type ZoneChoisie = {
  numero: number;
  frais_centimes: number;
  minimum_centimes: number;
  delai_min: number;
  delai_max: number;
};



export type Choix = {
  mode: Mode;
  adresse?: Adresse;
  details?: Details;
  zone?: ZoneChoisie;
  quand: Quand;
  // Vrai quand le moment choisi n'est possible que pour un panier 100 % pizzas (après la dernière commande de la carte).
  pizzasSeulement?: boolean;
  // « Dès que possible » : l'heure « vers » montrée à l'accueil, en minutes du jour, rappelée au paiement (CM-05).
  estimation?: number;
  // Préversion seulement : heure de Genève simulée par ?heure= sur l'accueil, transmise au calcul du panier.
  heureSimulee?: string;
  enregistreLe: number;
};

const CLE = "laferme.choix.v1";
// Repli quand le stockage est bloqué (navigation privée stricte) : le choix vit le temps de l'onglet.
let enMemoire: Choix | null = null;
// Au-delà, on redemande : l'heure « dès que possible » et les créneaux ne veulent plus rien dire.
const DUREE_VIE_MS = 12 * 60 * 60 * 1000;
// « Dès que possible » ne vaut que pour le moment où il a été choisi.
const DUREE_VIE_ASAP_MS = 30 * 60 * 1000;

export function lireChoix(): Choix | null {
  try {
    const brut = window.localStorage.getItem(CLE);
    const c = (brut ? JSON.parse(brut) : enMemoire) as Choix | null;
    if (!c || (c.mode !== "livraison" && c.mode !== "retrait")) return null;
    const age = Date.now() - (c.enregistreLe ?? 0);
    if (age > DUREE_VIE_MS || (c.quand?.type === "asap" && age > DUREE_VIE_ASAP_MS)) return null;
    if (c.mode === "livraison" && (!c.adresse || !c.zone)) return null;
    return c;
  } catch {
    return enMemoire;
  }
}

export function ecrireChoix(c: Omit<Choix, "enregistreLe">): void {
  enMemoire = { ...c, enregistreLe: Date.now() };
  try {
    window.localStorage.setItem(CLE, JSON.stringify(enMemoire));
  } catch {
    // Stockage bloqué : enMemoire suffit pour aller jusqu'à la carte.
  }
}
