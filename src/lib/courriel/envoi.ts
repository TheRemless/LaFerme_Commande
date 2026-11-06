import "server-only";
import { enregistrerCourriel } from "@/lib/db/serveur";

// Courriels aux clients. Resend en vrai ; sans clé, hors production, une doublure qui garde le courriel
// en base pour l'afficher sur /dev/courriels. Dans les deux cas, une copie est gardée pour le restaurant.

export type Courriel = { commandeId: string; destinataire: string; sujet: string; texte: string; html: string };

export async function envoyerCourriel(c: Courriel): Promise<void> {
  const cle = process.env.RESEND_API_KEY;
  const expediteur = process.env.COURRIEL_EXPEDITEUR;
  if (cle && expediteur) {
    const rep = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json", "Idempotency-Key": `${c.commandeId}-${c.sujet}`.slice(0, 256) },
      body: JSON.stringify({ from: expediteur, to: [c.destinataire], subject: c.sujet, text: c.texte, html: c.html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!rep.ok) throw new Error(`Resend a répondu ${rep.status}`);
  } else if (process.env.CONTEXTE_DEPLOIEMENT === "production") {
    throw new Error("RESEND_API_KEY ou COURRIEL_EXPEDITEUR manquant en production.");
  }
  await enregistrerCourriel({
    commande_id: c.commandeId,
    destinataire: c.destinataire,
    sujet: c.sujet,
    texte: c.texte,
    html: c.html,
    fournisseur: cle && expediteur ? "resend" : "doublure",
  });
}
