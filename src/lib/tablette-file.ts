import "server-only";
import { createHash } from "node:crypto";
import type { EtatImpression } from "@/lib/impression/service";
import type { CommandeTablette } from "@/lib/tablette";

// File de la tablette allégée (vague 3, mesures de qualite : 163 à 185 Ko toutes les 5 à 15 s par tablette).
// Les commandes terminées ou refusées partent sans leurs lignes (détail au toucher, /api/tablette/commande) ; les
// tâches d'impression seulement pour les commandes encore actives. Une version calculée sur tout ce que l'écran
// affiche permet de répondre 204, sans corps, quand rien n'a changé.

const FINIES = new Set(["terminee", "refusee"]);

export type CommandeFile = CommandeTablette & { lignes_omises?: true };

export function allegerFile(commandes: CommandeTablette[], impression: EtatImpression): { commandes: CommandeFile[]; impression: EtatImpression } {
  const actives = new Set(commandes.filter((c) => !FINIES.has(c.statut)).map((c) => c.id));
  return {
    commandes: commandes.map((c) => (FINIES.has(c.statut) ? { ...c, lignes: [], lignes_omises: true as const } : c)),
    impression: { ...impression, taches: (impression.taches ?? []).filter((t) => t.commande_id !== null && actives.has(t.commande_id)) },
  };
}

// Version de ce que la tablette affiche, hors heure : une imprimante en ligne relue toutes les 10 s (vue_le) ne
// doit pas la changer ; hors ligne, « hors ligne depuis 19h42 » s'affiche, donc vue_le compte.
export function versionFile(corps: { commandes: unknown; reglages: unknown; impression: EtatImpression; rythme: unknown; relecture_s: number }): string {
  const stable = {
    ...corps,
    impression: { ...corps.impression, imprimantes: corps.impression.imprimantes.map((i) => (i.en_ligne ? { ...i, vue_le: null } : i)) },
  };
  return createHash("sha1").update(JSON.stringify(stable)).digest("base64url").slice(0, 16);
}
