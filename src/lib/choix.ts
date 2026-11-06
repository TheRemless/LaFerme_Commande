// Choix du client (mode, adresse, créneau), gardé dans le navigateur seulement.
// Jamais dans l'URL ni envoyé à un outil tiers. Le serveur recontrôle tout au paiement.
import type { Adresse, Details } from "@/lib/adresse";
import type { Mode } from "@/lib/service";

export type ZoneChoisie = {
  numero: number;
  frais_centimes: number;
  minimum_centimes: number;
  delai_min: number;
  delai_max: number;
};

export type Quand = { type: "asap" } | { type: "creneau"; date: string; minutes: number } | { type: "aucun" };

export type Choix = {
  mode: Mode;
  adresse?: Adresse;
  details?: Details;
  zone?: ZoneChoisie;
  quand: Quand;
  enregistreLe: number;
};

const CLE = "laferme.choix.v1";
// Repli quand le stockage est bloqué (navigation privée stricte) : le choix vit le temps de l'onglet.
let enMemoire: Choix | null = null;
// Au-delà, on redemande : l'heure « dès que possible » et les créneaux ne veulent plus rien dire.
const DUREE_VIE_MS = 12 * 60 * 60 * 1000;

export function lireChoix(): Choix | null {
  try {
    const brut = window.localStorage.getItem(CLE);
    const c = (brut ? JSON.parse(brut) : enMemoire) as Choix | null;
    if (!c || (c.mode !== "livraison" && c.mode !== "retrait")) return null;
    if (Date.now() - (c.enregistreLe ?? 0) > DUREE_VIE_MS) return null;
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
