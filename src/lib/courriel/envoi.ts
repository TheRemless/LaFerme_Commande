import "server-only";
import { randomUUID } from "node:crypto";
import { enregistrerCourriel } from "@/lib/db/serveur";

// Courriels aux clients. Resend en vrai ; sans clé, hors production, une doublure qui garde le courriel
// en base pour l'afficher sur /dev/courriels. Dans les deux cas, une copie est gardée pour le restaurant.

export type Courriel = { commandeId: string; destinataire: string; sujet: string; texte: string; html: string };

export function resendConfigure(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.COURRIEL_EXPEDITEUR);
}

async function envoyerParResend(destinataire: string, sujet: string, texte: string, html: string, idempotence: string): Promise<void> {
  const rep = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotence.slice(0, 256),
    },
    body: JSON.stringify({ from: process.env.COURRIEL_EXPEDITEUR, to: [destinataire], subject: sujet, text: texte, html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!rep.ok) throw new Error(`Resend a répondu ${rep.status}`);
}

export async function envoyerCourriel(c: Courriel): Promise<void> {
  const resend = resendConfigure();
  if (resend) await envoyerParResend(c.destinataire, c.sujet, c.texte, c.html, `${c.commandeId}-${c.sujet}`);
  else if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error("RESEND_API_KEY ou COURRIEL_EXPEDITEUR manquant en production.");
  await enregistrerCourriel({
    commande_id: c.commandeId,
    destinataire: c.destinataire,
    sujet: c.sujet,
    texte: c.texte,
    html: c.html,
    fournisseur: resend ? "resend" : "doublure",
  });
}

// Code de connexion : jamais gardé en base, même en copie. Renvoie faux quand rien n'est parti
// (doublure, hors production) : l'appelant décide alors s'il peut montrer le code à l'écran.
export async function envoyerCodeParCourriel(m: { destinataire: string; sujet: string; texte: string; html: string }): Promise<boolean> {
  if (resendConfigure()) {
    await envoyerParResend(m.destinataire, m.sujet, m.texte, m.html, `code-${randomUUID()}`);
    return true;
  }
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error("RESEND_API_KEY ou COURRIEL_EXPEDITEUR manquant en production.");
  return false;
}
