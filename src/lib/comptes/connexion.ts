import "server-only";
import { courrielCode } from "@/lib/courriel/modeles";
import { courrielConfigure, envoyerCodeParCourriel } from "@/lib/courriel/envoi";
import { commandeParJeton, fonctionSql } from "@/lib/db/serveur";
import { empreinte, ipCourt, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";
import { baseDeTest } from "@/lib/environnement";
import { alerter } from "@/lib/surveillance";

// Demande et vérification d'un code de connexion. Les limites de débit et le compte vivent en base
// (demander_code, verifier_code) ; ici, les empreintes et l'envoi du courriel.

// Sans serveur d'envoi, aucun e-mail ne part. Le code ne s'affiche à l'écran que sur une base de test (base
// embarquée, ou projet déclaré par BASE_DE_TEST=1) et pour une adresse en .test. Sur une préversion qui
// écrit dans la vraie base, jamais : n'importe qui entrerait dans un compte, ou dans la tablette avec un
// membre de test (audit de sécurité, S1).
export function adresseDeTest(email: string): boolean {
  return /@[a-z0-9.-]+\.test$/.test(email);
}

export type ResultatDemandeCode =
  | { statut: "envoye"; codePreversion?: string }
  | { statut: "attente"; attente: number }
  | { statut: "adresse-preversion" }
  | { statut: "envoi-indisponible" };
// Le plafond quotidien ne concerne que les codes des clients.
export type ResultatDemande = ResultatDemandeCode | { statut: "plafond" };

// Sans serveur d'envoi hors production : aucun code possible sur la vraie base, adresse en .test exigée sur une base de test.
export function refusSansCourriel(email: string): ResultatDemandeCode | null {
  if (courrielConfigure() || process.env.CONTEXTE_DEPLOIEMENT === "production") return null;
  if (!baseDeTest()) return { statut: "envoi-indisponible" };
  return adresseDeTest(email) ? null : { statut: "adresse-preversion" };
}

// Rien n'est parti : le code ne revient à l'écran que sur une base de test (second garde-fou).
export function codeAffichable(code: string): ResultatDemandeCode {
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
  // -2 ou -3 : plafond global des codes clients sur 24 heures atteint (quota d'envoi de la boîte du
  // restaurant). Aucun code n'est créé. -3 au premier refus : le restaurant est prévenu une fois par 24 heures.
  if (attente < 0) {
    console.error("Plafond quotidien des codes de connexion des clients atteint.");
    if (attente === -3) {
      await alerter("Codes de connexion des clients : plafond du jour atteint", [
        "Le site a envoyé son maximum de codes de connexion aux clients sur 24 heures.",
        "Les clients ne peuvent plus se connecter à leur compte pour le moment. Ils peuvent toujours commander sans compte.",
        "Si ce n'est pas un jour d'affluence, quelqu'un abuse sans doute de la page de connexion.",
      ], "alerte", "plafond_codes").catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
    }
    return { statut: "plafond" };
  }
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
  const r = await fonctionSql<{ statut: string; attente?: number; compte_id?: string }>("verifier_code_limite", {
    p_email: email,
    p_cle_email: empreinte("email", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
    p_session_hache: empreinte("session", jeton),
    p_ancienne_session_hache: ancienJeton ? empreinte("session", ancienJeton) : null,
    p_jeton_commande: jetonCommande,
  });
  if (r.statut === "ok") {
    // Le code prouve l'adresse : les commandes passées en invité avec elle rejoignent le compte. Sans la
    // migration 20261202110000 (ou sur une erreur), la connexion réussit quand même.
    if (r.compte_id) {
      await fonctionSql<number>("rattacher_commandes_email", { p_compte: r.compte_id }).catch((e) =>
        console.error(`Commandes non rangées dans le compte : ${e instanceof Error ? e.message : e}`),
      );
    }
    return { statut: "ok", jeton };
  }
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: "invalide" };
}

// Commande du lien de suivi dont le client a coché « créer mon compte » et pas encore rattachée :
// seule source d'e-mail acceptée avec un jeton. Sans la case cochée, un lien transféré ne permet
// pas d'envoyer des codes au client.
export async function commandeACompte(jeton: unknown): Promise<{ email: string; jeton: string } | null> {
  if (typeof jeton !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) return null;
  const c = await commandeParJeton(jeton);
  return c && c.compte_demande && !c.compte_id && !c.detachee_du_compte ? { email: c.client_email, jeton: c.jeton_suivi } : null;
}
