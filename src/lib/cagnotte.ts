import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import { courrielConfigure, envoyerParSmtp } from "@/lib/courriel/envoi";
import { courrielRappelCagnotte } from "@/lib/courriel/modeles";
import { ADRESSE_SITE } from "@/lib/site";

// Cagnotte des clients (validée par Jérémy le 15.11.2026). Parrainage : deux types, le crédit du parrain et celui du
// filleul, que la fiduciaire peut traiter différemment (20261217100000, R28 et R29 du plan de conformité). Toutes les règles sont en base
// (supabase/migrations/20261216090000_cagnotte.sql) : gain à la remise, utilisation sous verrou du compte,
// restitution, retrait au remboursement, expiration. Ici, de simples appels et les textes des refus.

export type MouvementCagnotte = {
  type: "gain" | "utilise" | "rendu" | "retrait" | "expire" | "ajustement" | "parrainage_parrain" | "parrainage_filleul";
  montant_centimes: number;
  numero: number | null;
  motif: string | null;
  cree_le: string;
  par?: string | null;
};

export type CagnotteCompte = {
  active: boolean;
  solde_centimes: number;
  seuil_centimes: number;
  taux_pourcent: number;
  expire_le: string | null;
  rappel: boolean;
  mouvements: MouvementCagnotte[];
};

export type ReglagesFidelite = {
  active: boolean;
  taux_pourcent: number;
  seuil_centimes: number;
  soirs_doubles: { jours: number[]; dates: string[] };
  du_centimes: number;
  comptes: number;
  calcule_le: string;
  // Parrainage (20261216100000) : absents avant cette migration.
  parrainage_montant_centimes?: number;
  parrainage_plafond_mois?: number;
  parrainage_minimum_centimes?: number;
};

// Montant demandé par le navigateur, en centimes : un entier positif, sinon rien. La base le borne.
export function montantCagnotte(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 1_000_000 ? v : 0;
}

// Refus de la base (« cagnotte_refusee:<raison> »), en mots pour le client. Textes passés par redaction-fr.
export const MESSAGE_CAGNOTTE: Record<string, string> = {
  compte: "Connectez-vous à votre compte pour utiliser votre cagnotte.",
  desactive: "La cagnotte n'est pas disponible en ce moment. Décochez-la pour payer.",
  comptoir: "La cagnotte s'utilise avec le paiement en ligne.",
  seuil: "Votre cagnotte n'atteint plus le montant minimum, peut-être utilisée pour une autre commande. Rechargez la page.",
  montant: "La cagnotte ne peut pas servir pour cette commande. Décochez-la pour payer.",
};

export function messageCagnotte(e: unknown): string | null {
  const m = e instanceof Error ? /cagnotte_refusee:([a-z_]+)/.exec(e.message) : null;
  return m ? (MESSAGE_CAGNOTTE[m[1]] ?? MESSAGE_CAGNOTTE.montant) : null;
}

export const cagnotteCompte = (compte: string) => fonctionSql<CagnotteCompte | null>("cagnotte_compte", { p_compte: compte });

export const reglerRappelCagnotte = (compte: string, rappel: boolean) =>
  fonctionSql<boolean>("regler_rappel_cagnotte", { p_compte: compte, p_rappel: rappel });

export const reglagesFidelite = () => fonctionSql<ReglagesFidelite>("reglages_fidelite", {});

// Montant dû aux clients à la fin d'un jour (bilan de la fiduciaire, par exemple au 31.12).
export const duCagnottesAu = (jour: string) => fonctionSql<{ au: string; du_centimes: number; comptes: number }>("du_cagnottes_au", { p_jour: jour });

export const reglerFidelite = (
  p: Pick<ReglagesFidelite, "taux_pourcent" | "seuil_centimes" | "soirs_doubles" | "parrainage_montant_centimes" | "parrainage_plafond_mois" | "parrainage_minimum_centimes">,
  personnel: string,
) =>
  fonctionSql<ReglagesFidelite>("regler_fidelite", { p, p_personnel: personnel });

export const cagnotteClient = (email: string) =>
  fonctionSql<{ solde_centimes: number; expire_le: string | null; mouvements: MouvementCagnotte[] } | null>("cagnotte_client_gestion", { p_email: email });

export const ajusterCagnotte = (email: string, montant: number, motif: string, personnel: string) =>
  fonctionSql<number>("ajuster_cagnotte", { p_email: email, p_montant: montant, p_motif: motif, p_personnel: personnel });

// Refus d'un ajustement, en mots pour le gérant.
export function messageAjustement(e: unknown): string | null {
  const m = e instanceof Error ? /ajustement_refuse:([a-z]+)/.exec(e.message) : null;
  if (!m) return null;
  return (
    {
      montant: "Montant de CHF 0.01 à CHF 100, en plus ou en moins.",
      motif: "Écrivez un motif (3 à 200 caractères).",
      compte: "Ce client n'a pas de compte : la cagnotte va avec un compte.",
      negatif: "Le retrait dépasse le solde de la cagnotte.",
    } as Record<string, string>
  )[m[1]];
}

export function messageReglagesFidelite(e: unknown): string | null {
  const m = e instanceof Error ? /fidelite_refusee:([a-z]+)/.exec(e.message) : null;
  if (!m) return null;
  return ({ taux: "Taux de 3 à 10 %.", seuil: "Seuil de CHF 0 à CHF 50.", soirs: "Soirs doublés : jours de la semaine et dates (60 au plus).", parrainage: "Parrainage : de CHF 0 à CHF 50, de 0 à 100 par mois, minimum de CHF 0 à CHF 200." } as Record<string, string>)[m[1]];
}

// Aperçu au panier (affichage seulement, la base recalcule au paiement) : ce qu'un compte peut utiliser sur cette
// commande. Au plus le solde et les plats après remise, et CHF 0.50 restent à payer en ligne. Rien sous le seuil.
export function cagnotteUtilisable(solde: number, seuil: number, platsApresRemise: number, totalAPayer: number): number {
  if (solde < seuil) return 0;
  return Math.max(0, Math.min(solde, platsApresRemise, totalAPayer - 50));
}

// Tour quotidien (surveillance, premier tour du jour de service) : la cagnotte expirée part, puis les rappels de
// 30 jours partent un par un. Sans serveur d'envoi (local, préversion), le rappel est seulement noté au journal.
export async function tourCagnotte(): Promise<{ expirees: number; rappels: number }> {
  const expirees = await fonctionSql<number>("expirer_cagnottes", {});
  const dus = await fonctionSql<{ compte_id: string; activite_le: string; email: string; prenom: string; solde_centimes: number; expire_le: string }[]>("rappels_cagnotte_dus", {});
  const seuil = (await reglagesFidelite()).seuil_centimes;
  let rappels = 0;
  for (const r of dus) {
    const m = courrielRappelCagnotte({ ...r, seuil_centimes: seuil }, ADRESSE_SITE);
    if (!courrielConfigure()) {
      console.info(`Rappel de cagnotte (aucun courriel configuré) : ${m.sujet}`);
      continue;
    }
    // Noté seulement une fois parti : un envoi en panne ou un quota atteint repart au tour suivant.
    await envoyerParSmtp(r.email, m.sujet, m.texte, m.html, { type: m.type })
      .then(async () => {
        await fonctionSql("noter_rappel_cagnotte", { p_compte: r.compte_id, p_activite: r.activite_le });
        rappels++;
      })
      .catch((e) => console.error(`Rappel de cagnotte non envoyé : ${e instanceof Error ? e.message : e}`));
  }
  return { expirees, rappels };
}
