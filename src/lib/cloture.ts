// Clôture du jour (rapport Z) : types de ce que rend la base (cloture_jour, cloturer_jour) et export CSV.
// Aucun calcul ici : tout est fait en base, une seule fois.

import type { Synthese } from "@/lib/pilotage";

export type Ecart =
  | { type: "remise_sans_encaissement"; numero: number; centimes: number }
  | { type: "remboursement_echec" | "remboursement_en_cours"; numero: number; centimes: number }
  | { type: "pas_terminee"; numero: number; statut: string; centimes: number };

export type RapportCloture = {
  jour: string;
  debut: string;
  fin: string;
  calcule_le: string;
  ventes: Synthese;
  encaissements: {
    en_ligne: { commandes: number; centimes: number };
    comptoir: { commandes: number; centimes: number };
    deductions_centimes: number;
    especes_rendues_centimes: number;
    attendu_comptoir_centimes: number;
  };
  a_encaisser: { numero: number; mode: string; statut: string; du_centimes: number; heure: string }[];
  remboursements: {
    numero: number;
    montant_centimes: number;
    moyen: "stripe" | "especes" | "deduction";
    statut: "fait" | "en_cours" | "echec";
    motif: string;
    par: string;
    commande_refusee: boolean;
    erreur: string | null;
    heure: string;
  }[];
  ecarts: Ecart[];
};

export type Cloture = {
  jour: string;
  especes_comptees_centimes: number | null;
  carte_comptoir_centimes: number | null;
  attendu_comptoir_centimes: number;
  ecart_centimes: number | null;
  note: string;
  rapport: RapportCloture;
  personnel_nom: string;
  cloture_le: string;
};

export type ClotureJour = { rapport: RapportCloture; cloture: Cloture | null };

// Montant saisi en francs (« 1250.50 », « 1'250,50 »), vide = pas compté. undefined : illisible.
export function montantCompte(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const c = Math.round(v * 100);
    return Number.isFinite(v) && Math.abs(v * 100 - c) < 1e-6 && c >= 0 && c <= 100_000_000 ? c : undefined;
  }
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/['’\s]/g, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

const LIBELLE_ECART: Record<Ecart["type"], string> = {
  remise_sans_encaissement: "Remise au client sans encaissement",
  remboursement_echec: "Remboursement en échec",
  remboursement_en_cours: "Remboursement pas encore confirmé",
  pas_terminee: "Commande pas terminée",
};
export const libelleEcart = (e: Ecart) => LIBELLE_ECART[e.type];

const LIBELLE_MOYEN = { stripe: "en ligne", especes: "espèces", deduction: "déduit au comptoir" } as const;
const LIBELLE_STATUT = { fait: "fait", en_cours: "en cours", echec: "échec" } as const;

const chf = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const cellule = (v: string | number) => {
  const s = String(v);
  // Formules neutralisées (=, +, -, @ en tête) et séparateurs protégés, comme l'export comptable.
  const sur = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[;"\n]/.test(sur) ? `"${sur.replace(/"/g, '""')}"` : sur;
};
const ligne = (...v: (string | number)[]) => v.map(cellule).join(";");

// Rapport Z en CSV (point-virgule, BOM pour Excel), sans aucune donnée personnelle.
export function csvCloture(j: ClotureJour): string {
  const r = j.cloture?.rapport ?? j.rapport;
  const v = r.ventes;
  const e = r.encaissements;
  const l: string[] = [
    ligne("Clôture du jour", r.jour),
    ligne("Clôturé le", j.cloture ? `${j.cloture.cloture_le} par ${j.cloture.personnel_nom}` : "pas encore clôturé"),
    "",
    ligne("Ventes", "Commandes", "CHF"),
    ligne("Commandes prises (TTC)", v.commandes, chf(v.ttc_centimes)),
    ligne("dont livraison", v.livraison.commandes, chf(v.livraison.ttc_centimes)),
    ligne("dont à emporter", v.retrait.commandes, chf(v.retrait.ttc_centimes)),
    ligne("Frais de livraison", "", chf(v.frais_centimes)),
    ligne("Refusées", v.refusees.commandes, chf(v.refusees.ttc_centimes)),
    "",
    ligne("Encaissements", "Commandes", "CHF"),
    ligne("En ligne (TWINT ou carte)", e.en_ligne.commandes, chf(e.en_ligne.centimes)),
    ligne("Comptoir", e.comptoir.commandes, chf(e.comptoir.centimes)),
    ligne("Déduit au comptoir (manques)", "", chf(e.deductions_centimes)),
    ligne("Espèces rendues", "", chf(e.especes_rendues_centimes)),
    ligne("Attendu au comptoir", "", chf(e.attendu_comptoir_centimes)),
  ];
  if (j.cloture) {
    l.push(
      ligne("Espèces comptées", "", chf(j.cloture.especes_comptees_centimes)),
      ligne("Carte au comptoir (ticket du terminal)", "", chf(j.cloture.carte_comptoir_centimes)),
      ligne("Écart", "", chf(j.cloture.ecart_centimes)),
      ligne("Note", "", j.cloture.note),
    );
  }
  l.push("", ligne("TVA", "Taux %", "Ventes TTC", "Remboursé", "Net TTC", "TVA nette", "Net HT"));
  for (const t of v.tva) {
    l.push(ligne("", t.taux_pourcent, chf(t.ttc_centimes), chf(t.rembourse_centimes), chf(t.net_ttc_centimes), chf(t.net_tva_centimes), chf(t.net_ht_centimes)));
  }
  l.push("", ligne("À encaisser au comptoir", "Numéro", "Heure", "Statut", "CHF"));
  for (const a of r.a_encaisser) l.push(ligne("", a.numero, a.heure, a.statut, chf(a.du_centimes)));
  l.push("", ligne("Remboursements", "Numéro", "Heure", "Moyen", "Statut", "CHF", "Motif", "Par"));
  for (const x of r.remboursements) {
    l.push(ligne("", x.numero, x.heure, LIBELLE_MOYEN[x.moyen], LIBELLE_STATUT[x.statut], chf(x.montant_centimes), x.motif, x.par));
  }
  l.push("", ligne("À vérifier", "Numéro", "CHF"));
  for (const x of r.ecarts) l.push(ligne(libelleEcart(x), x.numero, chf(x.centimes)));
  return `﻿${l.join("\r\n")}\r\n`;
}
