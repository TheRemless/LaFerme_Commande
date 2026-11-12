import "server-only";
import nodemailer from "nodemailer";
import { courrielsPartis, enregistrerCourriel } from "@/lib/db/serveur";

// Courriels aux clients. En vrai : le serveur SMTP de la boîte du restaurant (Infomaniak par défaut,
// décision de Jérémy du 12.11.2026 à la place de Resend), avec l'adresse d'envoi comme identifiant et un
// mot de passe d'appareil. Sans ces réglages, hors production, une doublure qui garde le courriel en
// base pour l'afficher sur /dev/courriels. Dans les deux cas, une copie est gardée pour le restaurant.

export type Courriel = { commandeId: string; destinataire: string; sujet: string; texte: string; html: string };

const REGLAGES_MANQUANTS = "SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE ou COURRIEL_EXPEDITEUR manquant en production.";
const DELAI_SMTP_MS = 8000;

export function courrielConfigure(): boolean {
  return Boolean(process.env.SMTP_UTILISATEUR && process.env.SMTP_MOT_DE_PASSE && process.env.COURRIEL_EXPEDITEUR);
}

// Une connexion par courriel : une fonction sans serveur ne garde pas de connexion ouverte entre deux appels.
// Seuls les deux ports d'envoi chiffrés sont admis : 587 (STARTTLS exigé) et 465 (TLS dès la connexion).
export async function envoyerParSmtp(destinataire: string, sujet: string, texte: string, html: string): Promise<void> {
  const port = Number(process.env.SMTP_PORT || 587);
  if (port !== 587 && port !== 465) throw new Error("SMTP_PORT doit valoir 587 (STARTTLS) ou 465 (TLS).");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOTE || "mail.infomaniak.com",
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_UTILISATEUR, pass: process.env.SMTP_MOT_DE_PASSE },
    connectionTimeout: DELAI_SMTP_MS,
    greetingTimeout: DELAI_SMTP_MS,
    socketTimeout: DELAI_SMTP_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({ from: process.env.COURRIEL_EXPEDITEUR, to: destinataire, subject: sujet, text: texte, html });
  } catch (e) {
    // Le message du serveur peut citer l'adresse du client : seul le code part dans les journaux.
    const { responseCode, code } = e as { responseCode?: number; code?: string };
    throw new Error(`Le serveur d'envoi a répondu ${responseCode ?? code ?? "sans code"}.`);
  }
}

// Le même courriel rejoué (webhook répété) ne part qu'une fois en 24 heures, mais deux courriels au même
// sujet et au contenu différent (deux changements d'heure) partent tous les deux (SS-15). La copie gardée
// en base sert de registre : un courriel qui n'est pas parti n'y est pas et pourra repartir.
async function dejaParti(c: Courriel): Promise<boolean> {
  const partis = await courrielsPartis(c.commandeId);
  return partis.some((p) => p.destinataire === c.destinataire && p.sujet === c.sujet && p.texte === c.texte);
}

export async function envoyerCourriel(c: Courriel): Promise<void> {
  const smtp = courrielConfigure();
  if (smtp) {
    if (await dejaParti(c)) return;
    await envoyerParSmtp(c.destinataire, c.sujet, c.texte, c.html);
  } else if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error(REGLAGES_MANQUANTS);
  await enregistrerCourriel({
    commande_id: c.commandeId,
    destinataire: c.destinataire,
    sujet: c.sujet,
    texte: c.texte,
    html: c.html,
    fournisseur: smtp ? "smtp" : "doublure",
  });
}

// Code de connexion : jamais gardé en base, même en copie. Renvoie faux quand rien n'est parti
// (doublure, hors production) : l'appelant décide alors s'il peut montrer le code à l'écran.
export async function envoyerCodeParCourriel(m: { destinataire: string; sujet: string; texte: string; html: string }): Promise<boolean> {
  if (courrielConfigure()) {
    await envoyerParSmtp(m.destinataire, m.sujet, m.texte, m.html);
    return true;
  }
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error(REGLAGES_MANQUANTS);
  return false;
}
