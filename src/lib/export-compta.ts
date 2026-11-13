// Export pour la fiduciaire, récapitulatif par jour et par taux (export_recap_jours), et remboursements à
// suivre (remboursements_a_suivre). Calculs en base ; ici, seulement la mise en CSV.
// Format par défaut tant que la fiduciaire n'a pas répondu (question D9) : aucun numéro de compte.

import { celluleCsv } from "@/lib/gestion";

export type RecapJour = {
  jour: string;
  taux_tva_pourcent: number;
  ventes: number;
  en_ligne_centimes: number;
  comptoir_centimes: number;
  frais_centimes: number;
  ttc_centimes: number;
  tva_centimes: number;
  rembourse_en_ligne_centimes: number;
  rembourse_especes_centimes: number;
  deduit_centimes: number;
  tva_remboursee_centimes: number;
  net_ttc_centimes: number;
  net_tva_centimes: number;
  net_ht_centimes: number;
};

export type RemboursementASuivre = {
  id: string;
  commande_id: string;
  numero: number;
  jour: string;
  statut: "echec" | "en_cours";
  montant_centimes: number;
  moyen: "stripe" | "especes" | "deduction";
  motif: string;
  erreur: string | null;
  par: string;
  cree_le: string;
  commande_refusee: boolean;
};

const chf = (c: number) => (c / 100).toFixed(2);

// Une ligne par jour et par taux, puis le total de la période par taux. Remboursements en négatif.
export function csvRecapJours(lignes: RecapJour[]): string {
  const entete = [
    "Jour", "Taux TVA %", "Ventes", "En ligne CHF", "Comptoir CHF", "Dont livraison CHF", "Ventes TTC CHF", "TVA ventes CHF",
    "Remboursé en ligne CHF", "Rendu en espèces CHF", "Déduit au comptoir CHF", "TVA remboursée CHF", "Net TTC CHF", "TVA nette CHF", "Net HT CHF",
  ];
  const ligne = (l: RecapJour, jour: string) => [
    jour, String(l.taux_tva_pourcent), String(l.ventes), chf(l.en_ligne_centimes), chf(l.comptoir_centimes), chf(l.frais_centimes),
    chf(l.ttc_centimes), chf(l.tva_centimes), chf(-l.rembourse_en_ligne_centimes), chf(-l.rembourse_especes_centimes),
    chf(-l.deduit_centimes), chf(-l.tva_remboursee_centimes), chf(l.net_ttc_centimes), chf(l.net_tva_centimes), chf(l.net_ht_centimes),
  ];
  const rangs: string[][] = [entete, ...lignes.map((l) => ligne(l, String(l.jour).slice(0, 10)))];
  const totaux = new Map<number, RecapJour>();
  for (const l of lignes) {
    const t = totaux.get(l.taux_tva_pourcent);
    if (!t) {
      totaux.set(l.taux_tva_pourcent, { ...l });
      continue;
    }
    for (const k of Object.keys(l) as (keyof RecapJour)[]) {
      if (k !== "jour" && k !== "taux_tva_pourcent") (t[k] as number) += l[k] as number;
    }
  }
  if (totaux.size) {
    rangs.push([]);
    for (const t of [...totaux.values()].sort((a, b) => a.taux_tva_pourcent - b.taux_tva_pourcent)) rangs.push(ligne(t, "Total"));
  }
  return "﻿" + rangs.map((r) => r.map(celluleCsv).join(";")).join("\r\n") + "\r\n";
}
