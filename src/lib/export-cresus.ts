// Écritures pour Crésus Comptabilité (Epsitec), décision D9 de Jérémy du 13.11.2026. Base : export_cresus et
// plan_comptes_cresus (migration 20261214120000_export_cresus.sql). Doc : docs/pilotage.md.
//
// Format suivi : « Format d'un fichier d'écritures », format simple à six champs, manuel Crésus Comptabilité
// § 19.2 « Importer des données » (support.cresus.ch, PDF « © 2026 - EPSITEC », lu le 13.11.2026) :
//   date (jj.mm.aaaa), compte au débit, compte au crédit, numéro de pièce (vide : Crésus numérote selon les
//   options d'importation), libellé, montant ; champs séparés par une tabulation, lignes par CR+LF.
// Ce que le manuel ne dit pas, choisi pour ne pas dépendre de la réponse : texte en ASCII seul (identique en
// Windows-1252 et en UTF-8, les accents des libellés sont retirés), montant avec un point et sans séparateur
// de milliers (comme l'exemple du manuel, « 92.95 »), aucune ligne d'en-tête. Chaque écriture est un débit et un
// crédit simples. Le format étendu, avec la TVA, est plus bas (ecrituresEtendues, fichierCresusEtendu).

export const ROLES_COMPTES = ["caisse", "stripe", "terminal", "tva", "ventes", "livraison", "remboursements", "rabais", "cagnotte"] as const;
export type RoleCompte = (typeof ROLES_COMPTES)[number];
// Codes TVA du dossier Crésus, par taux (« 2.6 », « 8.1 ») : recopiés par le gérant, jamais devinés (R32).
export type CodesTva = Record<string, string>;
export type PlanComptes = { confirme: boolean; comptes: Record<RoleCompte, string>; codes_tva: CodesTva };
export const TAUX_CODES = ["2.6", "8.1"] as const;

export const LIBELLES_COMPTES: Record<RoleCompte, string> = {
  caisse: "Caisse (espèces au comptoir)",
  stripe: "Stripe (TWINT et cartes en ligne)",
  terminal: "Terminal de cartes au comptoir",
  tva: "TVA due",
  ventes: "Ventes",
  livraison: "Frais de livraison",
  remboursements: "Remboursements aux clients",
  rabais: "Rabais accordés (codes promo)",
  cagnotte: "Cagnotte utilisée par les clients",
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
const CODE_TVA = /^[A-Za-z0-9._-]{0,12}$/;

// Plan envoyé par l'écran : neuf comptes (chiffres, tous différents) et les codes TVA par taux (vides admis).
export function validerPlan(v: unknown): { ok: true; plan: Omit<PlanComptes, "confirme"> } | { ok: false; erreur: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, erreur: "Plan de comptes illisible." };
  const o = (v as Record<string, unknown>).comptes;
  const c = (v as Record<string, unknown>).codes_tva;
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).length !== ROLES_COMPTES.length) return { ok: false, erreur: "Plan de comptes illisible." };
  const comptes = {} as Record<RoleCompte, string>;
  for (const r of ROLES_COMPTES) {
    const x = (o as Record<string, unknown>)[r];
    const n = typeof x === "string" ? x.trim() : "";
    if (!COMPTE.test(n)) return { ok: false, erreur: `${LIBELLES_COMPTES[r]} : un numéro de compte, en chiffres.` };
    comptes[r] = n;
  }
  if (new Set(Object.values(comptes)).size !== ROLES_COMPTES.length) return { ok: false, erreur: "Deux rôles ont le même compte." };
  if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, erreur: "Codes TVA illisibles." };
  const codes: CodesTva = {};
  for (const t of TAUX_CODES) {
    const x = (c as Record<string, unknown>)[t];
    const code = typeof x === "string" ? x.trim() : "";
    if (!CODE_TVA.test(code)) return { ok: false, erreur: `Code TVA ${t.replace(".", ",")} % : lettres, chiffres, point ou tiret, 12 au plus.` };
    codes[t] = code;
  }
  return { ok: true, plan: { comptes, codes_tva: codes } };
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

// ---------- Format étendu, avec la TVA (comptes justes au droit suisse, docs/compta/plan-conformite.md) ----------
//
// Règles R14, R30, R31 de docs/compta/tva-et-cagnotte.md. Base : export_cresus_etendu (migration
// 20261217130000_compta_ventilation.sql). Chaque groupe est une écriture multiple de trois lignes sur le modèle de
// l'exemple officiel (manuel Crésus Comptabilité § 19.2) : hors taxe et TVA d'un côté avec la contrepartie « … »,
// le TTC de l'autre sur le compte du moyen d'encaissement. Mêmes champs 9 (écriture multiple) et 12 (écriture
// TVA), champ 10 = 1 (montant saisi TVA comprise), champ 11 = 1 (codes TVA), champ 13 = code TVA du dossier.
// Ventes au brut (R14) : le rabais des codes promo et la cagnotte utilisée sortent dans leur propre écriture, au
// débit de leur compte de diminution de recettes, au même code TVA. Un avoir par remboursement, à sa date (R11, R12).
//
// Seize champs : les champs 1 à 16 sont les mêmes sur la page web (20 champs) et dans le PDF (19) du manuel. Les
// champs 17 et suivants (période ou groupe, référence, commentaire) restent absents. Encodage Windows-1252 (déduit :
// le manuel range les fichiers texte « venant de Windows » à l'import du plan comptable), contrepartie « … » comme
// dans l'exemple, montant à zéro en monnaie étrangère (champ 7) et cours à zéro (champ 8, sans signification). À
// confirmer par le test d'acceptation R34 : une journée saisie à la main dans le Crésus du restaurant, exportée.

export type VenteEtendue = {
  jour: string;
  moyen: MoyenCresus;
  taux: number;
  nombre: number;
  ttc: number;
  tva: number;
  frais_ttc: number;
  frais_tva: number;
  rabais_ttc: number;
  rabais_tva: number;
  cagnotte_ttc: number;
  cagnotte_tva: number;
};
export type AvoirEtendu = {
  numero_avoir: number;
  jour: string;
  moyen: MoyenCresus;
  commande: number;
  stripe_refund_id: string | null;
  ventilation: { taux: number; ttc: number; tva: number }[];
};
export type DonneesEtendues = { ventes: VenteEtendue[]; avoirs: AvoirEtendu[] };

export const CONTREPARTIE = "…";
export type LigneEtendue = {
  date: string;
  debit: string;
  credit: string;
  libelle: string;
  centimes: number;
  multiple: number;
  code: string;
};

const cleTaux = (t: number) => Number(t).toFixed(1);
const tauxTexte = (t: number) => `${cleTaux(t).replace(".", ",")} %`;
const MOYENS_TEXTE: Record<MoyenCresus, string> = { stripe: "en ligne", caisse: "comptoir espèces", terminal: "comptoir carte" };

export function ecrituresEtendues(d: DonneesEtendues, plan: Pick<PlanComptes, "comptes" | "codes_tva">): { ok: true; lignes: LigneEtendue[] } | { ok: false; erreur: string } {
  const { comptes } = plan;
  const tous = [...d.ventes.map((v) => Number(v.taux)), ...d.avoirs.flatMap((a) => a.ventilation.map((x) => Number(x.taux)))];
  for (const t of [...new Set(tous)].sort((a, b) => a - b)) {
    if (!plan.codes_tva[cleTaux(t)]) {
      return { ok: false, erreur: `Code TVA du taux ${tauxTexte(t)} manquant : recopiez-le de la table TVA de votre dossier Crésus, dans le plan de comptes ci-dessous.` };
    }
  }
  const lignes: LigneEtendue[] = [];
  let n = 0;
  // Une écriture multiple : HT et TVA du côté « cote », TTC de l'autre côté sur le compte du moyen.
  const groupe = (date: string, cote: "credit" | "debit", compte: string, moyen: string, t: number, ttc: number, tva: number, libelle: string): string | null => {
    if (ttc === 0) return null;
    const ht = ttc - tva;
    if (ttc < 0 || tva < 0 || ht < 0) return `Montant négatif le ${date} (${libelle}) : export arrêté, à signaler.`;
    n += 1;
    const code = plan.codes_tva[cleTaux(t)];
    const l = (debit: string, credit: string, texte: string, c: number) => lignes.push({ date, debit, credit, libelle: texte, centimes: c, multiple: n, code });
    if (cote === "credit") {
      l(CONTREPARTIE, compte, libelle, ht);
      l(CONTREPARTIE, comptes.tva, `TVA, ${libelle.charAt(0).toLowerCase()}${libelle.slice(1)}`, tva);
      l(moyen, CONTREPARTIE, `${libelle}, TTC`, ttc);
    } else {
      l(compte, CONTREPARTIE, libelle, ht);
      l(comptes.tva, CONTREPARTIE, `TVA, ${libelle.charAt(0).toLowerCase()}${libelle.slice(1)}`, tva);
      l(CONTREPARTIE, moyen, `${libelle}, TTC`, ttc);
    }
    return null;
  };
  for (const v of d.ventes) {
    const date = dateCresus(v.jour);
    const moyen = comptes[v.moyen];
    const quoi = `${tauxTexte(v.taux)} ${MOYENS_TEXTE[v.moyen]}`;
    const num = (x: number | string) => Number(x);
    // Ventes au brut : le payé, sans les frais, plus ce que le rabais et la cagnotte ont déduit.
    const brutTtc = num(v.ttc) - num(v.frais_ttc) + num(v.rabais_ttc) + num(v.cagnotte_ttc);
    const brutTva = num(v.tva) - num(v.frais_tva) + num(v.rabais_tva) + num(v.cagnotte_tva);
    const erreur =
      groupe(date, "credit", comptes.ventes, moyen, v.taux, brutTtc, brutTva, `Ventes ${quoi}`) ??
      groupe(date, "credit", comptes.livraison, moyen, v.taux, num(v.frais_ttc), num(v.frais_tva), `Frais de livraison ${quoi}`) ??
      groupe(date, "debit", comptes.rabais, moyen, v.taux, num(v.rabais_ttc), num(v.rabais_tva), `Rabais des codes promo ${quoi}`) ??
      groupe(date, "debit", comptes.cagnotte, moyen, v.taux, num(v.cagnotte_ttc), num(v.cagnotte_tva), `Cagnotte utilisée ${quoi}`);
    if (erreur) return { ok: false, erreur };
  }
  for (const a of d.avoirs) {
    const date = dateCresus(a.jour);
    for (const x of a.ventilation) {
      const ref = a.stripe_refund_id ? `, ${a.stripe_refund_id}` : "";
      const erreur = groupe(date, "debit", comptes.remboursements, comptes[a.moyen], x.taux, Number(x.ttc), Number(x.tva),
        `Avoir ${a.numero_avoir}, commande ${a.commande}, ${tauxTexte(x.taux)} ${MOYENS_TEXTE[a.moyen]}${ref}`);
      if (erreur) return { ok: false, erreur };
    }
  }
  if (lignes.length === 0) return { ok: false, erreur: "Aucune vente ni remboursement sur la période : rien à importer." };
  return { ok: true, lignes };
}

// Windows-1252 : les caractères de Latin-1 tels quels, les 27 signes propres à Windows (dont « … » et « ’ ») à leur
// place, le reste replié sans accent ou retiré. Tabulations et retours à la ligne retirés des textes.
const WINDOWS_1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b,
  "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99,
  "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
export function windows1252(texte: string): Uint8Array {
  const octets: number[] = [];
  for (const ch of texte) {
    const c = ch.codePointAt(0)!;
    if (ch === "\t" || ch === "\r" || ch === "\n") octets.push(c);
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) octets.push(c);
    else if (WINDOWS_1252[ch] !== undefined) octets.push(WINDOWS_1252[ch]);
    else for (const r of ascii(ch)) octets.push(r.codePointAt(0)!);
  }
  return Uint8Array.from(octets);
}

const texteChamp = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();

// Seize champs par ligne, tabulation, CR+LF.
export function fichierCresusEtendu(lignes: LigneEtendue[]): Uint8Array {
  const texte = lignes
    .map((l) => {
      const lib = texteChamp(l.libelle);
      return [l.date, l.debit, l.credit, "", lib, (l.centimes / 100).toFixed(2), "0", "0", String(l.multiple), "1", "1", String(l.multiple), l.code, lib, "", ""].join("\t") + "\r\n";
    })
    .join("");
  return windows1252(texte);
}
