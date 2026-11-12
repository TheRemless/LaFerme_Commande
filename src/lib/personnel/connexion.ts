import "server-only";
import { after } from "next/server";
import { courrielBlocagePersonnel, courrielCode } from "@/lib/courriel/modeles";
import { courrielConfigure, envoyerCodeParCourriel, envoyerParSmtp } from "@/lib/courriel/envoi";
import { enregistrerCourriel, fonctionSql } from "@/lib/db/serveur";
import { codeAffichable, refusSansCourriel, type ResultatDemandeCode, type ResultatVerification } from "@/lib/comptes/connexion";
import { empreinte, ipCourt, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";
import { heureTexte, instantGeneve, jourTexte } from "@/lib/service";
import { alerter } from "@/lib/surveillance";

// Audit de sécurité, S11 : une adresse inconnue répondait aussitôt, une adresse de l'équipe après l'envoi
// du courriel. Deux protections : toute demande dure au moins ce temps, et le courriel part après la
// réponse (un envoi SMTP dure plusieurs échanges avec le serveur, plus que ce plancher depuis un autre continent).
export const DUREE_MIN_DEMANDE_MS = 1500;

// Connexion du personnel par code e-mail. Mêmes règles que les clients (docs/comptes.md), mais seules
// les adresses inscrites dans la table personnel reçoivent un code. La réponse ne le dit pas.

export async function demanderCodePersonnel(email: string, ip: string): Promise<ResultatDemandeCode> {
  const refus = refusSansCourriel(email);
  if (refus) return refus;
  // Même plancher en cas d'erreur (base en panne) : un refus rapide trahirait aussi une adresse de l'équipe.
  const [r] = await Promise.allSettled([demander(email, ip), new Promise((ok) => setTimeout(ok, DUREE_MIN_DEMANDE_MS))]);
  if (r.status === "rejected") throw r.reason;
  return r.value;
}

async function demander(email: string, ip: string): Promise<ResultatDemandeCode> {
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
  const courriel = { destinataire: email, ...courrielCode(code) };
  if (courrielConfigure()) {
    // Après la réponse : ni la durée de l'envoi ni son échec ne distinguent une adresse de l'équipe (S11).
    // Le code n'apparaît dans aucun journal, seul le code de réponse du serveur d'envoi.
    await apresReponse(
      envoyerCodeParCourriel(courriel).then(
        () => undefined,
        (e) => console.error(`Code du personnel non envoyé : ${e instanceof Error ? e.message : e}`),
      ),
    );
    return { statut: "envoye" };
  }
  const envoye = await envoyerCodeParCourriel(courriel);
  return envoye ? { statut: "envoye" } : codeAffichable(code);
}

export async function verifierCodePersonnel(
  email: string,
  code: string,
  ip: string,
  ancienJeton: string | null,
): Promise<Exclude<ResultatVerification, { statut: "ok" }> | { statut: "ok"; jeton: string; role: string | null }> {
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
  // Envoyé après la réponse : attendre les courriels ralentirait le 15e essai pour la seule équipe (S11).
  if (r.bloque && r.jusqu_a) await apresReponse(prevenirBlocage(email, r.jusqu_a).catch((e) => console.error(`Alerte de blocage non envoyée : ${e instanceof Error ? e.message : e}`)));
  if (r.statut === "ok") {
    // Rôle de la session neuve : le cookie d'un livreur dure 12 heures (S2-15).
    const p = await fonctionSql<{ role: string } | null>("personnel_de_session", { p_session_hache: empreinte("session-personnel", jeton) });
    return { statut: "ok", jeton, role: p?.role ?? null };
  }
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: "invalide" };
}

async function prevenirBlocage(email: string, jusquA: string): Promise<void> {
  const fin = instantGeneve(new Date(jusquA));
  const quand = `${jourTexte(fin.date)} à ${heureTexte(fin.minutes)}`;
  const m = courrielBlocagePersonnel(quand);
  const smtp = courrielConfigure();
  if (smtp) await envoyerParSmtp(email, m.sujet, m.texte, m.html);
  await enregistrerCourriel({ commande_id: null, destinataire: email, sujet: m.sujet, texte: m.texte, html: m.html, fournisseur: smtp ? "smtp" : "doublure" });
  await alerter("Adresse de l'équipe bloquée 24 heures, La Ferme", [
    `L'adresse ${email} a reçu 15 codes faux sur la tablette ou le back-office.`,
    `La connexion par code est bloquée jusqu'au ${quand}. Les appareils déjà connectés restent connectés.`,
    "Si ce n'était pas ce membre de l'équipe, quelqu'un connaît son adresse et essaie d'entrer.",
  ]);
}

// after() de Next (waitUntil de Netlify) dans une requête ; hors requête (tests), on attend.
async function apresReponse(travail: Promise<void>): Promise<void> {
  try {
    after(travail);
  } catch {
    // En production, ce repli rendrait la durée de l'envoi visible (S11) : il doit se voir dans les journaux.
    if (process.env.CONTEXTE_DEPLOIEMENT === "production") console.error("after() indisponible : travail attendu avant la réponse.");
    await travail;
  }
}
