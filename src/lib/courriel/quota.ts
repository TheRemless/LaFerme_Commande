import "server-only";
import { fonctionSql } from "@/lib/db/serveur";

// Quota d'envoi de la boîte Infomaniak (500 e-mails par 24 heures, docs/comptes.md). Chaque envoi SMTP réserve
// une place avant de partir (migration 20261202100000). Les types les moins utiles s'arrêtent d'abord :
// à 80 % du plafond les alertes, à 85 % « prête » et « en route », à 95 % les codes et le reste du suivi.
// Les confirmations de commande partent jusqu'au bout. Plafond réglable : COURRIELS_PLAFOND_JOUR (Jérémy fait relever la limite).

export type TypeCourriel =
  | "code"
  | "confirmation"
  | "acceptation"
  | "nouvelle_heure"
  | "refus"
  | "remboursement"
  | "manque"
  | "client_absent"
  | "blocage"
  | "suivi"
  | "prete"
  | "en_route"
  | "alerte"
  | "alerte_quota";

// Les codes passent sous les confirmations : une demande de code se fabrique sans compte, une commande
// payée non (revue de sécurité du quota). Un attaquant qui épuise les codes laisse partir les confirmations.
export const PRIORITE_COURRIEL: Record<TypeCourriel, 1 | 2 | 3 | 4> = {
  confirmation: 1,
  code: 2,
  // L'alerte « 80 % atteints » doit partir : sinon personne ne sait que les e-mails vont s'arrêter.
  alerte_quota: 1,
  acceptation: 2,
  nouvelle_heure: 2,
  refus: 2,
  remboursement: 2,
  manque: 2,
  client_absent: 2,
  blocage: 2,
  suivi: 2,
  prete: 3,
  en_route: 3,
  alerte: 4,
};

export const PLAFOND_PAR_DEFAUT = 500;

export function plafondJour(): number {
  const n = Number(process.env.COURRIELS_PLAFOND_JOUR);
  return Number.isInteger(n) && n > 0 ? n : PLAFOND_PAR_DEFAUT;
}

// Variante « moins d'e-mails » (préparée, désactivée tant que Jérémy n'a pas tranché) : COURRIELS_REDUITS=1
// garde « reçue » et « acceptée », et laisse « prête » et « en route » à la seule page de suivi.
// 300 commandes : environ 600 e-mails par jour au lieu de 900.
export function courrielSupprime(type: TypeCourriel | undefined): boolean {
  return process.env.COURRIELS_REDUITS === "1" && (type === "prete" || type === "en_route");
}

export class QuotaAtteint extends Error {
  constructor(type: TypeCourriel) {
    super(`E-mail « ${type} » non envoyé : limite d'envoi du jour atteinte.`);
    this.name = "QuotaAtteint";
  }
}

export type Reservation = { id: number; alerte80: boolean } | null;

// null : le journal n'existe pas encore (code déployé avant la migration) ; l'envoi part comme avant.
export async function reserverEnvoi(type: TypeCourriel, commandeId: string | null): Promise<Reservation> {
  let r: { ok: boolean; id?: number; alerte_80?: boolean };
  try {
    r = await fonctionSql("reserver_envoi", { p_type: type, p_priorite: PRIORITE_COURRIEL[type], p_commande: commandeId, p_plafond: plafondJour() });
  } catch (e) {
    console.error(`Quota d'e-mails non vérifié : ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!r.ok) throw new QuotaAtteint(type);
  return { id: r.id!, alerte80: Boolean(r.alerte_80) };
}

export async function terminerEnvoi(r: Reservation, ok: boolean): Promise<void> {
  if (!r) return;
  await fonctionSql("terminer_envoi", { p_id: r.id, p_ok: ok }).catch((e) => console.error(`Envoi non clos dans le journal : ${e instanceof Error ? e.message : e}`));
}

export type EtatQuota = { envoyes: number; refuses: number; plafond: number; restants: number; libere_a: string | null; alerte: boolean };

// Pour l'accueil du back-office (bo-socle) : où en est la journée.
export async function etatQuotaCourriels(): Promise<EtatQuota> {
  return fonctionSql<EtatQuota>("etat_quota_courriels", { p_plafond: plafondJour() });
}
