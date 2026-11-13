// Écritures pour Crésus Comptabilité (Epsitec), décision D9 de Jérémy du 13.11.2026. Base : export_cresus et
// plan_comptes_cresus (migration 20261214120000_export_cresus.sql). Doc : docs/pilotage.md.
//
// Format suivi : « Format d'un fichier d'écritures », format simple à six champs, manuel Crésus Comptabilité
// § 19.2 « Importer des données » (support.cresus.ch, PDF « © 2026 - EPSITEC », lu le 13.11.2026) :
//   date (jj.mm.aaaa), compte au débit, compte au crédit, numéro de pièce (vide : Crésus numérote selon les
//   options d'importation), libellé, montant ; champs séparés par une tabulation, lignes par CR+LF.
// Ce que le manuel ne dit pas, choisi pour ne pas dépendre de la réponse : texte en ASCII seul (identique en
// Windows-1252 et en UTF-8, les accents des libellés sont retirés), montant avec un point et sans séparateur
// de milliers (comme l'exemple du manuel, « 92.95 »), aucune ligne d'en-tête. Le format étendu (codes TVA,
// écritures multiples) n'est pas utilisé : sa liste de champs diffère entre la page web et le PDF du manuel,
// et son exemple ne suit pas sa propre liste. Chaque écriture est donc un débit et un crédit simples.

export const ROLES_COMPTES = ["caisse", "stripe", "terminal", "tva", "ventes", "livraison", "remboursements"] as const;
export type RoleCompte = (typeof ROLES_COMPTES)[number];
export type PlanComptes = { confirme: boolean; comptes: Record<RoleCompte, string> };

export const LIBELLES_COMPTES: Record<RoleCompte, string> = {
  caisse: "Caisse (espèces au comptoir)",
  stripe: "Stripe (TWINT et cartes en ligne)",
  terminal: "Terminal de cartes au comptoir",
  tva: "TVA due",
  ventes: "Ventes",
  livraison: "Frais de livraison",
  remboursements: "Remboursements aux clients",
};

export type MoyenCresus = "stripe" | "caisse" | "terminal";
export type LigneCresus = {
  jour: string;
  taux_tva_pourcent: number;
  sorte: "vente" | "remboursement";
  moyen: MoyenCresus;
  nombre: number;
  ttc_centimes: number;
  tva_centimes: number;
  frais_centimes: number;
  tva_frais_centimes: number;
};
export type Ecriture = { date: string; debit: string; credit: string; libelle: string; centimes: number };

const COMPTE = /^[0-9]{1,10}$/;

// Plan envoyé par l'écran : sept comptes, chiffres seulement, tous différents.
export function validerPlan(v: unknown): { ok: true; comptes: Record<RoleCompte, string> } | { ok: false; erreur: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Plan de comptes illisible." };
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== ROLES_COMPTES.length) return { ok: false, erreur: "Plan de comptes illisible." };
  const comptes = {} as Record<RoleCompte, string>;
  for (const r of ROLES_COMPTES) {
    const c = typeof o[r] === "string" ? (o[r] as string).trim() : "";
    if (!COMPTE.test(c)) return { ok: false, erreur: `${LIBELLES_COMPTES[r]} : un numéro de compte, en chiffres.` };
    comptes[r] = c;
  }
  if (new Set(Object.values(comptes)).size !== ROLES_COMPTES.length) return { ok: false, erreur: "Deux rôles ont le même compte." };
  return { ok: true, comptes };
}

const MOYENS: Record<MoyenCresus, string> = { stripe: "en ligne", caisse: "comptoir especes", terminal: "comptoir carte" };

// 2026-11-13 → 13.11.2026
const dateCresus = (jour: string) => {
  const [a, m, j] = jour.slice(0, 10).split("-");
  return `${j}.${m}.${a}`;
};
const taux = (t: number) => `${String(t)}%`;

// Les lignes du jour deviennent des écritures simples. Ventes : moyen au débit, ventes, livraison et TVA au
// crédit. Remboursements : l'inverse. La somme des écritures d'une ligne vaut toujours son TTC.
// Plusieurs taux sur la période : refusé, le plan n'a qu'un compte de ventes.
export function ecrituresCresus(lignes: LigneCresus[], comptes: Record<RoleCompte, string>): { ok: true; ecritures: Ecriture[] } | { ok: false; erreur: string } {
  const lesTaux = [...new Set(lignes.map((l) => Number(l.taux_tva_pourcent)))].sort((a, b) => a - b);
  if (lesTaux.length > 1) {
    return { ok: false, erreur: `Plusieurs taux de TVA sur la période (${lesTaux.join(" % et ")} %) : le plan de comptes n'a qu'un compte de ventes.` };
  }
  const ecritures: Ecriture[] = [];
  const ajouter = (date: string, debit: string, credit: string, libelle: string, centimes: number) => {
    if (centimes > 0) ecritures.push({ date, debit, credit, libelle, centimes });
  };
  for (const l of lignes) {
    const date = dateCresus(l.jour);
    const moyen = comptes[l.moyen];
    const quoi = MOYENS[l.moyen];
    const ttc = Number(l.ttc_centimes);
    const tva = Number(l.tva_centimes);
    if (l.sorte === "vente") {
      const livraisonHt = Number(l.frais_centimes) - Number(l.tva_frais_centimes);
      ajouter(date, moyen, comptes.ventes, `Ventes ${quoi} HT`, ttc - tva - livraisonHt);
      ajouter(date, moyen, comptes.livraison, `Frais de livraison ${quoi} HT`, livraisonHt);
      ajouter(date, moyen, comptes.tva, `TVA ${taux(l.taux_tva_pourcent)} ventes ${quoi}`, tva);
    } else {
      ajouter(date, comptes.remboursements, moyen, `Remboursements ${quoi} HT`, ttc - tva);
      ajouter(date, comptes.tva, moyen, `TVA ${taux(l.taux_tva_pourcent)} remboursements ${quoi}`, tva);
    }
  }
  return { ok: true, ecritures };
}

// Texte en ASCII seul : accents retirés, tout autre caractère hors ASCII imprimable supprimé (tabulations et
// retours à la ligne compris, qui casseraient les champs).
export function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

export function fichierCresus(ecritures: Ecriture[]): string {
  return ecritures
    .map((e) => [e.date, e.debit, e.credit, "", ascii(e.libelle), (e.centimes / 100).toFixed(2)].join("\t") + "\r\n")
    .join("");
}
