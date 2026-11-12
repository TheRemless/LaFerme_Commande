import "server-only";
import { courrielCode } from "@/lib/courriel/modeles";
import { envoyerCodeParCourriel, resendConfigure } from "@/lib/courriel/envoi";
import { commandeParJeton, fonctionSql } from "@/lib/db/serveur";
import { empreinte, ipCourt, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";
import { baseDeTest } from "@/lib/environnement";

// Demande et vérification d'un code de connexion. Les limites de débit et le compte vivent en base
// (demander_code, verifier_code) ; ici, les empreintes et l'envoi du courriel.

// Sans Resend, aucun e-mail ne part. Le code ne s'affiche à l'écran que sur une base de test (base
// embarquée, ou projet déclaré par BASE_DE_TEST=1) et pour une adresse en .test. Sur une préversion qui
// écrit dans la vraie base, jamais : n'importe qui entrerait dans un compte, ou dans la tablette avec un
// membre de test (audit de sécurité, S1).
export function adresseDeTest(email: string): boolean {
  return /@[a-z0-9.-]+\.test$/.test(email);
}

export type ResultatDemande =
  | { statut: "envoye"; codePreversion?: string }
  | { statut: "attente"; attente: number }
  | { statut: "adresse-preversion" }
  | { statut: "envoi-indisponible" };

// Sans Resend hors production : aucun code possible sur la vraie base, adresse en .test exigée sur une base de test.
export function refusSansCourriel(email: string): ResultatDemande | null {
  if (resendConfigure() || process.env.CONTEXTE_DEPLOIEMENT === "production") return null;
  if (!baseDeTest()) return { statut: "envoi-indisponible" };
  return adresseDeTest(email) ? null : { statut: "adresse-preversion" };
}

// Rien n'est parti : le code ne revient à l'écran que sur une base de test (second garde-fou).
export function codeAffichable(code: string): ResultatDemande {
  if (!baseDeTest()) throw new Error("Code de connexion non envoyé : aucun e-mail configuré.");
  return { statut: "envoye", codePreversion: code };
}

export async function demanderCode(email: string, ip: string): Promise<ResultatDemande> {
  const refus = refusSansCourriel(email);
  if (refus) return refus;
  const code = nouveauCode();
  const attente = await fonctionSql<number>("demander_code", {
    p_email: email,
    p_cle_email: empreinte("email", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
  });
  if (attente > 0) return { statut: "attente", attente };
  const envoye = await envoyerCodeParCourriel({ destinataire: email, ...courrielCode(code) });
  return envoye ? { statut: "envoye" } : codeAffichable(code);
}

export type ResultatVerification =
  | { statut: "ok"; jeton: string }
  | { statut: "invalide" }
  | { statut: "attente"; attente: number };

export async function verifierCode(
  email: string,
  code: string,
  ip: string,
  ancienJeton: string | null,
  jetonCommande: string | null,
): Promise<ResultatVerification> {
  // Jeton neuf à chaque connexion : un jeton posé avant (par un tiers, ou une ancienne session) ne sert plus.
  const jeton = nouveauJeton();
  const r = await fonctionSql<{ statut: string; attente?: number }>("verifier_code_limite", {
    p_email: email,
    p_cle_email: empreinte("email", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
    p_session_hache: empreinte("session", jeton),
    p_ancienne_session_hache: ancienJeton ? empreinte("session", ancienJeton) : null,
    p_jeton_commande: jetonCommande,
  });
  if (r.statut === "ok") return { statut: "ok", jeton };
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: "invalide" };
}

// Commande du lien de suivi dont le client a coché « créer mon compte » et pas encore rattachée :
// seule source d'e-mail acceptée avec un jeton. Sans la case cochée, un lien transféré ne permet
// pas d'envoyer des codes au client.
export async function commandeACompte(jeton: unknown): Promise<{ email: string; jeton: string } | null> {
  if (typeof jeton !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) return null;
  const c = await commandeParJeton(jeton);
  return c && c.compte_demande && !c.compte_id ? { email: c.client_email, jeton: c.jeton_suivi } : null;
}
