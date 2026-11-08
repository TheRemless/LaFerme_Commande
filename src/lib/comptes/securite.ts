import "server-only";
import { createHmac, randomBytes, randomInt } from "node:crypto";

// Empreintes des secrets de connexion : codes, jetons de session, e-mails et adresses IP des limites.
// HMAC-SHA-256 avec une clé tirée de SECRET_COMPTES, ou à défaut de la clé secrète Supabase : une copie
// de la base ne suffit pas pour retrouver un code ou une IP. Sans aucune clé (poste local, tests), une clé
// fixe de développement ; jamais en production.

function cleHmac(): string {
  const source = process.env.SECRET_COMPTES ?? process.env.SUPABASE_SECRET_KEY;
  if (source) return `laferme-comptes:${source}`;
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") throw new Error("SECRET_COMPTES ou SUPABASE_SECRET_KEY manquante en production.");
  return "laferme-comptes:developpement-local";
}

export function empreinte(usage: "code" | "session" | "email" | "ip" | "email-personnel" | "session-personnel", valeur: string): string {
  return createHmac("sha256", cleHmac()).update(`${usage}:${valeur}`).digest("hex");
}

export function nouveauCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function nouveauJeton(): string {
  return randomBytes(32).toString("base64url");
}

export { emailNormalise } from "@/lib/validation";

export function codeValide(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.replace(/\s/g, "");
  return /^\d{6}$/.test(c) ? c : null;
}

// Adresse IP du client. Netlify la donne dans x-nf-client-connection-ip, que le client ne peut pas imposer.
// Ailleurs (poste local), la première de x-forwarded-for, sinon « local ».
export function ipDe(requete: Request): string {
  const netlify = requete.headers.get("x-nf-client-connection-ip");
  if (netlify) return netlify.trim();
  const transmis = (requete.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // Poste local : la première valeur (les tests s'en servent pour simuler plusieurs clients).
  if (process.env.CONTEXTE_DEPLOIEMENT === "local") return transmis[0] || "local";
  // Ailleurs, la dernière : celle ajoutée par le proxy, que le client ne choisit pas. Jamais une valeur
  // commune à tous, qui rendrait les limites par IP globales au site.
  return transmis.at(-1) || "inconnue";
}

// Ce que le journal garde de l'IP : huit caractères de son empreinte, assez pour voir une rafale.
export function ipCourt(ip: string): string {
  return empreinte("ip", ip).slice(0, 8);
}
