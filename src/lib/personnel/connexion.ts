import "server-only";
import { courrielCode } from "@/lib/courriel/modeles";
import { envoyerCodeParCourriel } from "@/lib/courriel/envoi";
import { fonctionSql } from "@/lib/db/serveur";
import { codeAffichable, refusSansCourriel, type ResultatDemande, type ResultatVerification } from "@/lib/comptes/connexion";
import { empreinte, ipCourt, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";

// Connexion du personnel par code e-mail. Mêmes règles que les clients (docs/comptes.md), mais seules
// les adresses inscrites dans la table personnel reçoivent un code. La réponse ne le dit pas.

export async function demanderCodePersonnel(email: string, ip: string): Promise<ResultatDemande> {
  const refus = refusSansCourriel(email);
  if (refus) return refus;
  const code = nouveauCode();
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
  const r = await fonctionSql<{ statut: string; attente?: number }>("verifier_code_personnel_limite", {
    p_email: email,
    p_cle_email: empreinte("email-personnel", email),
    p_cle_ip: empreinte("ip", ip),
    p_code_hache: empreinte("code", code),
    p_ip_court: ipCourt(ip),
    p_session_hache: empreinte("session-personnel", jeton),
    p_ancienne_session_hache: ancienJeton ? empreinte("session-personnel", ancienJeton) : null,
  });
  if (r.statut === "ok") return { statut: "ok", jeton };
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: "invalide" };
}
