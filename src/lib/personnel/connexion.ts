import "server-only";
import { courrielBlocagePersonnel, courrielCode } from "@/lib/courriel/modeles";
import { envoyerCodeParCourriel, envoyerParResend, resendConfigure } from "@/lib/courriel/envoi";
import { enregistrerCourriel, fonctionSql } from "@/lib/db/serveur";
import { codeAffichable, refusSansCourriel, type ResultatDemande, type ResultatVerification } from "@/lib/comptes/connexion";
import { empreinte, ipCourt, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";
import { heureTexte, instantGeneve, jourTexte } from "@/lib/service";
import { alerter } from "@/lib/surveillance";

// Audit de sécurité, S11 : une adresse inconnue répondait aussitôt, une adresse de l'équipe après l'envoi
// par Resend. Toute demande dure désormais au moins ce temps, ce qui couvre un envoi ordinaire.
export const DUREE_MIN_DEMANDE_MS = 1500;

// Connexion du personnel par code e-mail. Mêmes règles que les clients (docs/comptes.md), mais seules
// les adresses inscrites dans la table personnel reçoivent un code. La réponse ne le dit pas.

export async function demanderCodePersonnel(email: string, ip: string): Promise<ResultatDemande> {
  const refus = refusSansCourriel(email);
  if (refus) return refus;
  // Même plancher en cas d'erreur (Resend en panne) : un refus rapide trahirait aussi une adresse de l'équipe.
  const [r] = await Promise.allSettled([demander(email, ip), new Promise((ok) => setTimeout(ok, DUREE_MIN_DEMANDE_MS))]);
  if (r.status === "rejected") throw r.reason;
  return r.value;
}

async function demander(email: string, ip: string): Promise<ResultatDemande> {
  // 8 chiffres pour l'équipe (audit de sécurité, S4) : 100 fois moins de chances par essai qu'un code client.
  const code = nouveauCode(8);
  const attente = await fonctionSql<number>("demander_code_personnel", {
    p_email: email,
    p_cle_email: empreinte("email-personnel", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
  });
  if (attente > 0) return { statut: "attente", attente };
  // Adresse inconnue : même réponse, aucun courriel (on n'écrit pas à quelqu'un qui n'est pas de l'équipe).
  if (attente < 0) return { statut: "envoye" };
  const envoye = await envoyerCodeParCourriel({ destinataire: email, ...courrielCode(code) });
  return envoye ? { statut: "envoye" } : codeAffichable(code);
}

export async function verifierCodePersonnel(email: string, code: string, ip: string, ancienJeton: string | null): Promise<ResultatVerification> {
  const jeton = nouveauJeton();
  const r = await fonctionSql<{ statut: string; attente?: number; bloque?: boolean; jusqu_a?: string }>("verifier_code_personnel_limite", {
    p_email: email,
    p_cle_email: empreinte("email-personnel", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
    p_session_hache: empreinte("session-personnel", jeton),
    p_ancienne_session_hache: ancienJeton ? empreinte("session-personnel", ancienJeton) : null,
  });
  // 15e code faux sur une adresse de l'équipe : on prévient le membre et le restaurant (une fois par blocage).
  if (r.bloque && r.jusqu_a) await prevenirBlocage(email, r.jusqu_a).catch((e) => console.error(`Alerte de blocage non envoyée : ${e instanceof Error ? e.message : e}`));
  if (r.statut === "ok") return { statut: "ok", jeton };
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: "invalide" };
}

async function prevenirBlocage(email: string, jusquA: string): Promise<void> {
  const fin = instantGeneve(new Date(jusquA));
  const quand = `${jourTexte(fin.date)} à ${heureTexte(fin.minutes)}`;
  const m = courrielBlocagePersonnel(quand);
  const resend = resendConfigure();
  if (resend) await envoyerParResend(email, m.sujet, m.texte, m.html, `blocage-${empreinte("email-personnel", email).slice(0, 16)}-${jusquA}`);
  await enregistrerCourriel({ commande_id: null, destinataire: email, sujet: m.sujet, texte: m.texte, html: m.html, fournisseur: resend ? "resend" : "doublure" });
  await alerter("Adresse de l'équipe bloquée 24 heures, La Ferme", [
    `L'adresse ${email} a reçu 15 codes faux sur la tablette ou le back-office.`,
    `La connexion par code est bloquée jusqu'au ${quand}. Les appareils déjà connectés restent connectés.`,
    "Si ce n'était pas ce membre de l'équipe, quelqu'un connaît son adresse et essaie d'entrer.",
  ]);
}
