// Clôture du jour (rapport Z) : types de ce que rend la base (cloture_jour, cloturer_jour) et export CSV.
// Aucun calcul ici : tout est fait en base, une seule fois.

import { celluleCsv } from "@/lib/gestion";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import type { Synthese } from "@/lib/pilotage";

export type Ecart =
  | { type: "remise_sans_encaissement"; numero: number; centimes: number }
  | { type: "remboursement_echec" | "remboursement_en_cours"; numero: number; centimes: number }
  | { type: "pas_terminee"; numero: number; statut: string; centimes: number }
  // Commande modifiée (vague 3, bo-commandes) : complément à la porte ou au comptoir pas marqué encaissé.
  | { type: "complement_sans_encaissement"; numero: number; centimes: number; moyen: string };

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
    // Moyen noté par la tablette (absents d'un rapport enregistré avant cette séparation).
    comptoir_especes?: { commandes: number; centimes: number };
    comptoir_carte?: { commandes: number; centimes: number };
    comptoir_non_note?: { commandes: number; centimes: number };
    attendu_especes_centimes?: number;
    attendu_carte_centimes?: number;
    // Compléments des commandes modifiées (vague 3, bo-commandes), absents d'un rapport enregistré avant eux.
    complements?: { en_ligne_centimes: number; especes_centimes: number; carte_centimes: number; a_encaisser_centimes: number };
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
  personnel_nom: string;
  cloture_le: string;
};

// rapport : celui enregistré à la clôture si le jour est clôturé, sinon celui calculé maintenant.
// change_depuis : une commande ou un remboursement du jour a changé depuis la clôture (à reclôturer).
export type ClotureJour = { rapport: RapportCloture; cloture: Cloture | null; change_depuis: boolean };

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
  complement_sans_encaissement: "Complément de commande modifiée pas marqué encaissé",
};
export const libelleEcart = (e: Ecart) => LIBELLE_ECART[e.type];

// À l'écran et à l'impression : l'argent à suivre ligne par ligne, les commandes pas terminées en une seule ligne
// (en plein service, elles sont des dizaines et noieraient le reste). L'export CSV garde le détail.
export type PasTerminees = { commandes: number; centimes: number; parStatut: [string, number][]; liste: Extract<Ecart, { type: "pas_terminee" }>[] };
export function regrouperEcarts(ecarts: Ecart[]): { aSuivre: Ecart[]; pasTerminees: PasTerminees } {
  const liste = ecarts.filter((e): e is Extract<Ecart, { type: "pas_terminee" }> => e.type === "pas_terminee");
  const parStatut = new Map<string, number>();
  for (const e of liste) parStatut.set(e.statut, (parStatut.get(e.statut) ?? 0) + 1);
  return {
    aSuivre: ecarts.filter((e) => e.type !== "pas_terminee"),
    pasTerminees: { commandes: liste.length, centimes: liste.reduce((t, e) => t + e.centimes, 0), parStatut: [...parStatut], liste },
  };
}

const LIBELLE_MOYEN = { stripe: "en ligne", especes: "espèces", deduction: "déduit au comptoir" } as const;
const LIBELLE_STATUT = { fait: "fait", en_cours: "en cours", echec: "échec" } as const;

const chf = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const ligne = (...v: (string | number)[]) => v.map((x) => celluleCsv(String(x))).join(";");

// Rapport Z en CSV (point-virgule, BOM pour Excel), sans aucune donnée personnelle.
export function csvCloture(j: ClotureJour): string {
  const r = j.rapport;
  const v = r.ventes;
  const e = r.encaissements;
  const l: string[] = [
    ligne("Clôture du jour", r.jour),
    ligne(
      "Clôturé le",
      j.cloture ? `${jourGeneveDe(j.cloture.cloture_le)} à ${heureDe(j.cloture.cloture_le)} par ${j.cloture.personnel_nom}` : "pas encore clôturé",
    ),
    ...(j.change_depuis ? [ligne("Attention", "des commandes ont changé depuis la clôture : reclôturer")] : []),
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
    ...(e.comptoir_especes && e.comptoir_carte && e.comptoir_non_note
      ? [
          ligne("dont espèces", e.comptoir_especes.commandes, chf(e.comptoir_especes.centimes)),
          ligne("dont carte", e.comptoir_carte.commandes, chf(e.comptoir_carte.centimes)),
          ligne("dont moyen pas noté", e.comptoir_non_note.commandes, chf(e.comptoir_non_note.centimes)),
        ]
      : []),
    ...(e.complements
      ? [
          ligne("Compléments payés par lien (dans « En ligne »)", "", chf(e.complements.en_ligne_centimes)),
          ligne("Compléments encaissés en espèces", "", chf(e.complements.especes_centimes)),
          ligne("Compléments encaissés par carte", "", chf(e.complements.carte_centimes)),
          ligne("Compléments encore à encaisser", "", chf(e.complements.a_encaisser_centimes)),
        ]
      : []),
    ligne("Déduit au comptoir (manques)", "", chf(e.deductions_centimes)),
    ligne("Espèces rendues", "", chf(e.especes_rendues_centimes)),
    ligne("Attendu au comptoir", "", chf(e.attendu_comptoir_centimes)),
    ...(e.attendu_especes_centimes !== undefined && e.attendu_carte_centimes !== undefined
      ? [ligne("Attendu en espèces", "", chf(e.attendu_especes_centimes)), ligne("Attendu en carte", "", chf(e.attendu_carte_centimes))]
      : []),
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
